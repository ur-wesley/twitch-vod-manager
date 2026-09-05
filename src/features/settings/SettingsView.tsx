import type { Component } from "solid-js";
import { createEffect, createSignal, For, Show } from "solid-js";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "solid-sonner";
import { Button } from "~/components/ui/button";
import { UpdateDialog } from "~/components/UpdateDialog";
import { Input } from "~/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  checkForUpdates,
  exportSettingsToml,
  getSettings,
  importSettingsToml,
  listS3Vods,
  listWebdavVods,
  loginGdrive,
  logoutGdrive,
  loginTwitch,
  logoutTwitch,
  loginYouTube,
  logoutYouTube,
  saveSettings,
  type UpdateInfoDto,
  workerGetStatus,
  workerSyncSettings,
} from "~/services/tauri";
import type { AppSettings, FfmpegInfo, TwitchUser, WorkerStatus } from "~/types";

export interface SettingsViewProps {
  settings: AppSettings;
  ffmpegInfo: FfmpegInfo | null;
  twitchUser?: TwitchUser | null;
  version?: string;
  onSettingsSaved: (newSettings: AppSettings) => void;
  onOpenDownloader?: () => void;
  onBack?: () => void;
}

export const SettingsView: Component<SettingsViewProps> = (props) => {
  const [formData, setFormData] = createSignal<AppSettings>({ ...props.settings });
  const [activeSubTab, setActiveSubTab] = createSignal("general");
  const [saving, setSaving] = createSignal(false);
  const [s3TestStatus, setS3TestStatus] = createSignal<string | null>(null);
  const [s3Testing, setS3Testing] = createSignal(false);

  // Google Drive state
  const [gdriveLoggingIn, setGdriveLoggingIn] = createSignal(false);
  const [showAdvancedGdrive, setShowAdvancedGdrive] = createSignal(false);

  // Twitch state
  const [twitchLoggingIn, setTwitchLoggingIn] = createSignal(false);
  const [showAdvancedTwitch, setShowAdvancedTwitch] = createSignal(false);

  // YouTube state
  const [youtubeLoggingIn, setYoutubeLoggingIn] = createSignal(false);
  const [showAdvancedYouTube, setShowAdvancedYouTube] = createSignal(false);
  const [showEncodingBestPractices, setShowEncodingBestPractices] = createSignal(false);

  // WebDAV state
  const [webdavTesting, setWebdavTesting] = createSignal(false);
  const [webdavTestStatus, setWebdavTestStatus] = createSignal<string | null>(null);

  // Cloud Worker (VPS) state
  const [workerTesting, setWorkerTesting] = createSignal(false);
  const [workerTestStatus, setWorkerTestStatus] = createSignal<string | null>(null);
  const [workerStatusData, setWorkerStatusData] = createSignal<WorkerStatus | null>(null);
  const [workerSyncing, setWorkerSyncing] = createSignal(false);

  // Raw TOML Dialog state
  const [rawTomlOpen, setRawTomlOpen] = createSignal(false);
  const [rawTomlContent, setRawTomlContent] = createSignal("");
  const [tomlApplying, setTomlApplying] = createSignal(false);
  const [liveToml, setLiveToml] = createSignal("");

  const [checkingUpdates, setCheckingUpdates] = createSignal(false);
  const [updateInfo, setUpdateInfo] = createSignal<UpdateInfoDto | null>(null);
  const [updateOpen, setUpdateOpen] = createSignal(false);

  createEffect(() => {
    setFormData({ ...props.settings });
  });

  const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleCheckForUpdates = async () => {
    setCheckingUpdates(true);
    const result = await checkForUpdates();
    setCheckingUpdates(false);
    result.match(
      (info) => {
        if (!info) {
          toast.success("You're on the latest version");
          return;
        }
        setUpdateInfo(info);
        setUpdateOpen(true);
      },
      (err) => toast.error(err.message)
    );
  };

  const refreshLiveToml = async () => {
    const tomlRes = await exportSettingsToml();
    if (tomlRes.isOk()) {
      setLiveToml(tomlRes.value);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const result = await saveSettings(formData());
    result.match(
      () => {
        setSaving(false);
        props.onSettingsSaved(formData());
        void refreshLiveToml();
        toast.success("Settings saved successfully");
      },
      (err) => {
        setSaving(false);
        toast.error(`Failed to save settings: ${err.message}`);
      }
    );
  };

  const handlePickOutputDir = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        updateField("output_dir", selected);
      }
    } catch (e) {
      toast.error(`Folder selection failed: ${String(e)}`);
    }
  };

  const handlePickTempDir = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        updateField("temp_dir", selected);
      }
    } catch (e) {
      toast.error(`Folder selection failed: ${String(e)}`);
    }
  };

  const handlePickFfmpegPath = async () => {
    try {
      const selected = await openDialog({
        directory: false,
        multiple: false,
        filters: [{ name: "Executable", extensions: ["exe", "*"] }],
      });
      if (selected && typeof selected === "string") {
        updateField("ffmpeg_path", selected);
      }
    } catch (e) {
      toast.error(`File selection failed: ${String(e)}`);
    }
  };

  const handleTestS3 = async () => {
    setS3Testing(true);
    setS3TestStatus("Connecting to S3 bucket...");
    // Save current values first to ensure backend uses them
    const saveRes = await saveSettings(formData());
    if (saveRes.isErr()) {
      setS3Testing(false);
      setS3TestStatus(`Failed to apply settings: ${saveRes.error.message}`);
      return;
    }

    const testRes = await listS3Vods();
    setS3Testing(false);
    testRes.match(
      (objs) => {
        setS3TestStatus(`Success! Bucket reachable (${objs.length} existing objects found).`);
        toast.success("S3 connection verified!");
      },
      (err) => {
        setS3TestStatus(`Connection error: ${err.message}`);
        toast.error(`S3 Test Failed: ${err.message}`);
      }
    );
  };

  const handleLoginGdrive = async () => {
    setGdriveLoggingIn(true);
    await saveSettings(formData());
    const res = await loginGdrive();
    setGdriveLoggingIn(false);
    res.match(
      () => {
        toast.success("Google Drive connected successfully!");
        getSettings().match(
          (s) => {
            setFormData(s);
            props.onSettingsSaved(s);
          },
          () => {}
        );
      },
      (err) => {
        toast.error(`Google Drive connection failed: ${err.message}`);
      }
    );
  };

  const handleDisconnectGdrive = async () => {
    const res = await logoutGdrive();
    res.match(
      () => {
        toast.info("Google Drive disconnected.");
        getSettings().match(
          (s) => {
            setFormData(s);
            props.onSettingsSaved(s);
          },
          () => {}
        );
      },
      (err) => {
        toast.error(`Failed to disconnect Google Drive: ${err.message}`);
      }
    );
  };

  const handleLoginTwitch = async () => {
    setTwitchLoggingIn(true);
    await saveSettings(formData());
    const res = await loginTwitch();
    setTwitchLoggingIn(false);
    res.match(
      (user) => {
        toast.success(`Connected to Twitch as @${user.login}!`);
        getSettings().match(
          (s) => {
            setFormData(s);
            props.onSettingsSaved(s);
          },
          () => {}
        );
      },
      (err) => {
        toast.error(`Twitch login failed: ${err.message}`);
      }
    );
  };

  const handleDisconnectTwitch = async () => {
    const res = await logoutTwitch();
    res.match(
      () => {
        toast.info("Twitch account disconnected.");
        getSettings().match(
          (s) => {
            setFormData(s);
            props.onSettingsSaved(s);
          },
          () => {}
        );
      },
      (err) => {
        toast.error(`Failed to disconnect Twitch: ${err.message}`);
      }
    );
  };

  const handleLoginYouTube = async () => {
    setYoutubeLoggingIn(true);
    await saveSettings(formData());
    const res = await loginYouTube();
    setYoutubeLoggingIn(false);
    res.match(
      () => {
        toast.success("YouTube connected successfully!");
        getSettings().match(
          (s) => {
            setFormData(s);
            props.onSettingsSaved(s);
          },
          () => {}
        );
      },
      (err) => {
        toast.error(`YouTube connection failed: ${err.message}`);
      }
    );
  };

  const handleDisconnectYouTube = async () => {
    const res = await logoutYouTube();
    res.match(
      () => {
        toast.info("YouTube account disconnected.");
        getSettings().match(
          (s) => {
            setFormData(s);
            props.onSettingsSaved(s);
          },
          () => {}
        );
      },
      (err) => {
        toast.error(`Failed to disconnect YouTube: ${err.message}`);
      }
    );
  };

  const handleTestWebdav = async () => {
    if (!formData().webdav_endpoint) {
      toast.error("Please enter a WebDAV Endpoint URL.");
      return;
    }
    setWebdavTesting(true);
    setWebdavTestStatus("Connecting to WebDAV server...");
    await saveSettings(formData());
    const res = await listWebdavVods();
    setWebdavTesting(false);
    res.match(
      (files) => {
        setWebdavTestStatus(`Success! WebDAV server reachable (${files.length} existing files found).`);
        toast.success("WebDAV connection verified!");
      },
      (err) => {
        setWebdavTestStatus(`Connection error: ${err.message}`);
        toast.error(`WebDAV Test Failed: ${err.message}`);
      }
    );
  };

  const handleTestWorker = async () => {
    const url = formData().worker_url?.trim();
    if (!url) {
      toast.error("Please enter a Worker Server URL first.");
      return;
    }
    setWorkerTesting(true);
    setWorkerTestStatus("Connecting to Cloud Worker...");
    await saveSettings(formData());
    const res = await workerGetStatus(url, formData().worker_api_key);
    setWorkerTesting(false);
    res.match(
      (st) => {
        setWorkerStatusData(st);
        setWorkerTestStatus(`Connected! Worker v${st.version} (Uptime: ${Math.floor(st.uptime_secs / 60)}m, Status: ${st.status})`);
        toast.success("VPS Worker connection successful!");
      },
      (err) => {
        setWorkerStatusData(null);
        setWorkerTestStatus(`Failed to connect: ${err.message}`);
        toast.error(`Worker Connection Failed: ${err.message}`);
      }
    );
  };

  const handleSyncWorker = async () => {
    const url = formData().worker_url?.trim();
    if (!url) {
      toast.error("Please enter a Worker Server URL first.");
      return;
    }
    setWorkerSyncing(true);
    await saveSettings(formData());
    const res = await workerSyncSettings(url, formData().worker_api_key);
    setWorkerSyncing(false);
    res.match(
      () => {
        toast.success("Settings & credentials successfully synced to Cloud Worker!");
      },
      (err) => {
        toast.error(`Worker Sync Failed: ${err.message}`);
      }
    );
  };

  const handleImportTomlFile = async () => {
    try {
      const filePath = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "TOML Settings", extensions: ["toml"] }],
      });

      if (filePath && typeof filePath === "string") {
        const content = await readTextFile(filePath);
        const res = await importSettingsToml(content);
        res.match(
          (s) => {
            setFormData(s);
            props.onSettingsSaved(s);
            void refreshLiveToml();
            toast.success("Settings successfully imported from TOML!");
          },
          (err) => {
            toast.error(`TOML Import Failed: ${err.message}`);
          }
        );
      }
    } catch (e) {
      toast.error(`Import failed: ${String(e)}`);
    }
  };

  const handleExportTomlFile = async () => {
    try {
      const tomlRes = await exportSettingsToml();
      if (tomlRes.isErr()) {
        toast.error(`Failed to serialize TOML: ${tomlRes.error.message}`);
        return;
      }

      const savePath = await saveDialog({
        defaultPath: "twitch-vod-manager.toml",
        filters: [{ name: "TOML Configuration", extensions: ["toml"] }],
      });

      if (savePath && typeof savePath === "string") {
        await writeTextFile(savePath, tomlRes.value);
        toast.success(`Exported TOML to ${savePath.split("\\").pop() || "file"}`);
      }
    } catch (e) {
      toast.error(`Export failed: ${String(e)}`);
    }
  };

  const handleOpenRawTomlModal = async () => {
    const tomlRes = await exportSettingsToml();
    if (tomlRes.isOk()) {
      setRawTomlContent(tomlRes.value);
    } else {
      setRawTomlContent("# Paste your TOML configuration here\n");
    }
    setRawTomlOpen(true);
  };

  const handleApplyRawToml = async () => {
    setTomlApplying(true);
    const res = await importSettingsToml(rawTomlContent());
    setTomlApplying(false);
    res.match(
      (s) => {
        setFormData(s);
        props.onSettingsSaved(s);
        setRawTomlOpen(false);
        void refreshLiveToml();
        toast.success("TOML configuration applied!");
      },
      (err) => {
        toast.error(`Invalid TOML: ${err.message}`);
      }
    );
  };

  createEffect(() => {
    if (activeSubTab() !== "toml") return;
    void props.settings;
    void refreshLiveToml();
  });

  return (
    <div class="flex h-full flex-col overflow-hidden bg-background font-sans">
      {/* Header matching project-vault */}
      <header class="flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-sidebar px-6">
        <div class="flex items-center gap-3">
          <Show when={props.onBack}>
            <Button
              variant="ghost"
              size="icon"
              onClick={props.onBack}
              class="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <span class="iconify mdi--arrow-left size-4" />
            </Button>
          </Show>
          <div class="flex items-center gap-2">
            <h2 class="text-base font-bold tracking-tight text-foreground font-heading">
              Settings & Preferences
            </h2>
            <span class="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary font-mono">
              {props.version || "v0.1.0"}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <Button
            type="button"
            class="h-9 font-bold shadow-sm hover:shadow-md transition-all gap-1.5"
            disabled={saving()}
            onClick={handleSave}
          >
            <span class="iconify mdi--content-save size-4" />
            {saving() ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </header>

      {/* Main Settings Tabs Area */}
      <div class="flex-1 overflow-hidden px-6 py-6">
        <div class="mx-auto w-full max-w-5xl h-full flex flex-col gap-6">
          <Tabs
            value={activeSubTab()}
            onChange={setActiveSubTab}
            class="flex flex-1 flex-col overflow-hidden"
          >
            <TabsList class="mb-4 h-auto min-h-9 w-full shrink-0 flex gap-1 bg-muted/40 p-1 rounded-lg border border-border/40">
              <TabsTrigger
                value="general"
                class="flex-1 px-2.5 text-xs font-semibold uppercase tracking-wider data-[selected]:bg-card data-[selected]:text-foreground data-[selected]:shadow-sm rounded-md transition-all"
              >
                <span class="iconify mdi--tune mr-1.5 size-3.5" />
                General
              </TabsTrigger>
              <TabsTrigger
                value="accounts"
                class="flex-1 px-2.5 text-xs font-semibold uppercase tracking-wider data-[selected]:bg-card data-[selected]:text-foreground data-[selected]:shadow-sm rounded-md transition-all"
              >
                <span class="iconify mdi--account-key mr-1.5 size-3.5" />
                Accounts
              </TabsTrigger>
              <TabsTrigger
                value="tools"
                class="flex-1 px-2.5 text-xs font-semibold uppercase tracking-wider data-[selected]:bg-card data-[selected]:text-foreground data-[selected]:shadow-sm rounded-md transition-all"
              >
                <span class="iconify mdi--hammer-wrench mr-1.5 size-3.5" />
                Tools
              </TabsTrigger>
              <TabsTrigger
                value="storage"
                class="flex-1 px-2.5 text-xs font-semibold uppercase tracking-wider data-[selected]:bg-card data-[selected]:text-foreground data-[selected]:shadow-sm rounded-md transition-all"
              >
                <span class="iconify mdi--cloud-outline mr-1.5 size-3.5" />
                Storage
              </TabsTrigger>
              <TabsTrigger
                value="encoding"
                class="flex-1 px-2.5 text-xs font-semibold uppercase tracking-wider data-[selected]:bg-card data-[selected]:text-foreground data-[selected]:shadow-sm rounded-md transition-all"
              >
                <span class="iconify mdi--video-vintage mr-1.5 size-3.5" />
                Encoding
              </TabsTrigger>
              <TabsTrigger
                value="worker"
                class="flex-1 px-2.5 text-xs font-semibold uppercase tracking-wider data-[selected]:bg-card data-[selected]:text-foreground data-[selected]:shadow-sm rounded-md transition-all"
              >
                <span class="iconify mdi--server-network mr-1.5 size-3.5" />
                Worker
              </TabsTrigger>
              <TabsTrigger
                value="toml"
                class="flex-1 px-2.5 text-xs font-semibold uppercase tracking-wider data-[selected]:bg-card data-[selected]:text-foreground data-[selected]:shadow-sm rounded-md transition-all"
              >
                <span class="iconify mdi--code-braces mr-1.5 size-3.5" />
                Data
              </TabsTrigger>
            </TabsList>

            <div class="w-full flex-1 overflow-y-auto pr-1 scrollbar-thin">
              {/* Tab 1: General */}
              <TabsContent value="general" class="space-y-6 outline-none animate-in fade-in duration-200">
                <section class="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
                  <div class="space-y-1">
                    <h3 class="text-sm font-bold uppercase tracking-wider text-primary">
                      File & Directory Paths
                    </h3>
                    <p class="text-xs text-muted-foreground">
                      Configure where compressed VODs are saved and where temporary segments are cached.
                    </p>
                  </div>

                  <div class="grid gap-4">
                    <div class="space-y-1.5">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Default Output Directory
                      </label>
                      <div class="flex gap-2">
                        <Input
                          type="text"
                          value={formData().output_dir || ""}
                          placeholder="e.g. C:\Users\Videos\TwitchVODs"
                          onInput={(e) => updateField("output_dir", e.currentTarget.value)}
                          class="bg-muted/30 font-mono text-xs"
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handlePickOutputDir}
                          class="shrink-0 text-xs gap-1.5"
                        >
                          <span class="iconify mdi--folder-open size-3.5" />
                          Browse
                        </Button>
                      </div>
                      <p class="text-[10px] text-muted-foreground">
                        Where completed, compressed MP4 archives will be stored on your disk.
                      </p>
                    </div>

                    <div class="space-y-1.5">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Temporary Chunk Work Directory
                      </label>
                      <div class="flex gap-2">
                        <Input
                          type="text"
                          value={formData().temp_dir || ""}
                          placeholder="Default: System Temp Directory"
                          onInput={(e) => updateField("temp_dir", e.currentTarget.value)}
                          class="bg-muted/30 font-mono text-xs"
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handlePickTempDir}
                          class="shrink-0 text-xs gap-1.5"
                        >
                          <span class="iconify mdi--folder-open size-3.5" />
                          Browse
                        </Button>
                      </div>
                      <p class="text-[10px] text-muted-foreground">
                        Used to download raw video segments before merging. Automatically cleaned up after processing.
                      </p>
                    </div>
                  </div>
                </section>

                <section class="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
                  <div class="space-y-1">
                    <h3 class="text-sm font-bold uppercase tracking-wider text-primary">Updates</h3>
                    <p class="text-xs text-muted-foreground">
                      Check GitHub Releases for a new desktop build.
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleCheckForUpdates}
                    disabled={checkingUpdates()}
                    class="gap-1.5 text-xs"
                  >
                    <span
                      class={`i-mdi-update size-3.5 ${checkingUpdates() ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    Check for updates
                  </Button>
                </section>
              </TabsContent>

              {/* Tab 2: Tools & System */}
              <TabsContent value="tools" class="space-y-6 outline-none animate-in fade-in duration-200">
                <section class="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
                  <div class="flex items-center justify-between">
                    <div class="space-y-1">
                      <h3 class="text-sm font-bold uppercase tracking-wider text-primary">
                        System Tools & Dependencies
                      </h3>
                      <p class="text-xs text-muted-foreground">
                        Twitch VOD Manager requires FFmpeg for stream extraction, concatenation, and hardware encoding.
                      </p>
                    </div>
                    <Show when={props.onOpenDownloader}>
                      <Button
                        size="sm"
                        onClick={props.onOpenDownloader}
                        class="text-xs font-bold gap-1.5 shadow-sm"
                      >
                        <span class="iconify mdi--download size-3.5" />
                        Download / Reinstall FFmpeg
                      </Button>
                    </Show>
                  </div>

                  {/* FFmpeg Status Card */}
                  <div class="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-3">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-3">
                        <div class="flex size-9 items-center justify-center rounded-lg bg-primary/20 text-primary">
                          <span class="iconify mdi--movie-play size-5" />
                        </div>
                        <div>
                          <div class="flex items-center gap-2">
                            <span class="text-sm font-bold">FFmpeg Engine</span>
                            <Show
                              when={props.ffmpegInfo?.available}
                              fallback={
                                <span class="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
                                  Not Detected
                                </span>
                              }
                            >
                              <span class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                                Ready
                              </span>
                            </Show>
                          </div>
                          <p class="text-[11px] text-muted-foreground font-mono truncate max-w-md">
                            {props.ffmpegInfo?.available
                              ? props.ffmpegInfo.path
                              : "Missing from system PATH and app data directory"}
                          </p>
                        </div>
                      </div>

                      <Show when={props.ffmpegInfo?.version}>
                        <span class="text-[10px] font-mono text-muted-foreground bg-muted/60 px-2 py-1 rounded">
                          {props.ffmpegInfo!.version}
                        </span>
                      </Show>
                    </div>

                    {/* Hardware Acceleration Pills */}
                    <div class="flex flex-wrap gap-2 pt-1 border-t border-border/30">
                      <span class="text-[11px] text-muted-foreground font-medium py-0.5">
                        Hardware Acceleration:
                      </span>
                      <Show
                        when={props.ffmpegInfo?.has_nvenc}
                        fallback={
                          <span class="rounded bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground/60 line-through">
                            NVIDIA NVENC
                          </span>
                        }
                      >
                        <span class="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                          <span class="iconify mdi--check size-3" /> NVIDIA NVENC
                        </span>
                      </Show>
                      <Show
                        when={props.ffmpegInfo?.has_qsv}
                        fallback={
                          <span class="rounded bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground/60 line-through">
                            Intel QuickSync
                          </span>
                        }
                      >
                        <span class="rounded bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-400 flex items-center gap-1">
                          <span class="iconify mdi--check size-3" /> Intel QuickSync
                        </span>
                      </Show>
                      <Show
                        when={props.ffmpegInfo?.has_amf}
                        fallback={
                          <span class="rounded bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground/60 line-through">
                            AMD AMF
                          </span>
                        }
                      >
                        <span class="rounded bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-400 flex items-center gap-1">
                          <span class="iconify mdi--check size-3" /> AMD AMF
                        </span>
                      </Show>
                    </div>
                  </div>

                  {/* Custom Binary Path */}
                  <div class="space-y-1.5 pt-2">
                    <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                      Custom FFmpeg Binary Path (Optional)
                    </label>
                    <div class="flex gap-2">
                      <Input
                        type="text"
                        value={formData().ffmpeg_path || ""}
                        placeholder="Leave empty to use auto-detected binary"
                        onInput={(e) => updateField("ffmpeg_path", e.currentTarget.value)}
                        class="bg-muted/30 font-mono text-xs"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handlePickFfmpegPath}
                        class="shrink-0 text-xs gap-1.5"
                      >
                        <span class="iconify mdi--folder-open size-3.5" />
                        Browse
                      </Button>
                    </div>
                    <p class="text-[10px] text-muted-foreground">
                      Point to a specific ffmpeg.exe binary if you do not want to use the default app or system version.
                    </p>
                  </div>
                </section>
              </TabsContent>

              {/* Tab 3: Storage (S3) */}
              <TabsContent value="storage" class="space-y-6 outline-none animate-in fade-in duration-200">
                <section class="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
                  <div class="space-y-1">
                    <h3 class="text-sm font-bold uppercase tracking-wider text-primary">
                      S3-Compatible Cloud Storage
                    </h3>
                    <p class="text-xs text-muted-foreground">
                      Archive your processed VODs to Cloudflare R2, Backblaze B2, or any standard AWS S3 endpoint.
                    </p>
                  </div>

                  {/* Provider Quick Presets */}
                  <div class="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={formData().s3_provider === "cloudflare_r2" ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        updateField("s3_provider", "cloudflare_r2");
                        updateField("s3_region", "auto");
                        if (!formData().s3_endpoint) {
                          updateField("s3_endpoint", "https://<account_id>.r2.cloudflarestorage.com");
                        }
                      }}
                      class="text-xs font-semibold"
                    >
                      Cloudflare R2
                    </Button>
                    <Button
                      type="button"
                      variant={formData().s3_provider === "backblaze_b2" ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        updateField("s3_provider", "backblaze_b2");
                        updateField("s3_region", "us-east-005");
                        if (!formData().s3_endpoint) {
                          updateField("s3_endpoint", "https://s3.us-east-005.backblazeb2.com");
                        }
                      }}
                      class="text-xs font-semibold"
                    >
                      Backblaze B2
                    </Button>
                    <Button
                      type="button"
                      variant={formData().s3_provider === "custom" ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateField("s3_provider", "custom")}
                      class="text-xs font-semibold"
                    >
                      Custom S3 / AWS
                    </Button>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="space-y-1.5">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        S3 Endpoint URL
                      </label>
                      <Input
                        type="text"
                        value={formData().s3_endpoint}
                        placeholder="https://<id>.r2.cloudflarestorage.com"
                        onInput={(e) => updateField("s3_endpoint", e.currentTarget.value)}
                        class="bg-muted/30 font-mono text-xs"
                      />
                    </div>

                    <div class="space-y-1.5">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Region
                      </label>
                      <Input
                        type="text"
                        value={formData().s3_region}
                        placeholder="auto"
                        onInput={(e) => updateField("s3_region", e.currentTarget.value)}
                        class="bg-muted/30 font-mono text-xs"
                      />
                    </div>

                    <div class="space-y-1.5">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Bucket Name
                      </label>
                      <Input
                        type="text"
                        value={formData().s3_bucket}
                        placeholder="my-vod-archive"
                        onInput={(e) => updateField("s3_bucket", e.currentTarget.value)}
                        class="bg-muted/30 font-mono text-xs"
                      />
                    </div>

                    <div class="space-y-1.5">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Access Key ID
                      </label>
                      <Input
                        type="text"
                        value={formData().s3_access_key}
                        placeholder="Access key ID"
                        onInput={(e) => updateField("s3_access_key", e.currentTarget.value)}
                        class="bg-muted/30 font-mono text-xs"
                      />
                    </div>

                    <div class="space-y-1.5 md:col-span-2">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Secret Access Key
                      </label>
                      <Input
                        type="password"
                        value={formData().s3_secret_key}
                        placeholder="Secret access key"
                        onInput={(e) => updateField("s3_secret_key", e.currentTarget.value)}
                        class="bg-muted/30 font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div class="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-border/40">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={s3Testing()}
                      onClick={handleTestS3}
                      class="text-xs font-bold gap-1.5"
                    >
                      <span class="iconify mdi--connection size-4" />
                      {s3Testing() ? "Testing Connection..." : "Test S3 Connection"}
                    </Button>

                    <Show when={s3TestStatus()}>
                      <p class="text-xs font-mono text-muted-foreground">
                        {s3TestStatus()}
                      </p>
                    </Show>
                  </div>
                </section>

                {/* Google Drive Configuration */}
                <section class="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
                  <div class="space-y-1">
                    <div class="flex items-center justify-between">
                      <h3 class="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                        <span class="iconify mdi--google-drive size-4 text-amber-500" />
                        Google Drive Storage
                      </h3>
                      <Show
                        when={formData().gdrive_access_token}
                        fallback={
                          <span class="text-[10px] font-bold text-muted-foreground bg-muted/60 px-2 py-0.5 rounded">
                            Not Connected
                          </span>
                        }
                      >
                        <span class="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                          <span class="iconify mdi--check size-3" /> Connected
                        </span>
                      </Show>
                    </div>
                    <p class="text-xs text-muted-foreground">
                      Upload directly to your Google Drive account using the official Drive API v3 (8 MB chunked resumable upload).
                    </p>
                  </div>

                  <div class="space-y-3">
                    <div class="space-y-1.5">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Target Folder ID (Optional)
                      </label>
                      <Input
                        type="text"
                        value={formData().gdrive_folder_id || ""}
                        placeholder="Leave empty for Drive root, or paste folder ID from drive.google.com/drive/folders/<ID>"
                        onInput={(e) => updateField("gdrive_folder_id", e.currentTarget.value)}
                        class="bg-muted/30 font-mono text-xs"
                      />
                      <p class="text-[10px] text-muted-foreground">
                        The alphanumeric ID from the end of your Google Drive folder's URL.
                      </p>
                    </div>

                    <div class="pt-2 flex flex-wrap items-center gap-3 border-t border-border/40">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        disabled={gdriveLoggingIn()}
                        onClick={handleLoginGdrive}
                        class="text-xs font-bold gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                      >
                        <span class={`iconify mdi--google-drive size-4 ${gdriveLoggingIn() ? "animate-spin" : ""}`} />
                        {gdriveLoggingIn()
                          ? "Waiting for Browser Auth..."
                          : formData().gdrive_access_token
                          ? "Re-authenticate Drive"
                          : "Connect Google Drive"}
                      </Button>

                      <Show when={formData().gdrive_access_token}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleDisconnectGdrive}
                          class="text-xs text-destructive hover:bg-destructive/10"
                        >
                          Disconnect
                        </Button>
                      </Show>

                      <span class="text-[10px] text-muted-foreground italic ml-auto">
                        Pre-configured 1-click login. No API setup required.
                      </span>
                    </div>

                    {/* Advanced Custom Credentials Toggle */}
                    <div class="pt-2">
                      <button
                        type="button"
                        onClick={() => setShowAdvancedGdrive(!showAdvancedGdrive())}
                        class="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <span class={`iconify mdi--chevron-right size-3.5 transition-transform ${showAdvancedGdrive() ? "rotate-90" : ""}`} />
                        Advanced: Custom Google Cloud Credentials (Optional)
                      </button>

                      <Show when={showAdvancedGdrive()}>
                        <div class="mt-3 p-3.5 rounded-lg border border-border/50 bg-muted/20 space-y-3">
                          <p class="text-[10px] text-muted-foreground">
                            By default, the app uses built-in desktop application credentials. If you have your own Google Cloud project, you can provide custom credentials below.
                          </p>
                          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div class="space-y-1">
                              <label class="text-[10px] font-bold text-muted-foreground uppercase">
                                Google OAuth Client ID
                              </label>
                              <Input
                                type="text"
                                value={formData().gdrive_client_id || ""}
                                placeholder="e.g. 123456789-abc.apps.googleusercontent.com"
                                onInput={(e) => updateField("gdrive_client_id", e.currentTarget.value)}
                                class="bg-muted/30 font-mono text-xs"
                              />
                            </div>
                            <div class="space-y-1">
                              <label class="text-[10px] font-bold text-muted-foreground uppercase">
                                Google OAuth Client Secret
                              </label>
                              <Input
                                type="password"
                                value={formData().gdrive_client_secret || ""}
                                placeholder="Client Secret"
                                onInput={(e) => updateField("gdrive_client_secret", e.currentTarget.value)}
                                class="bg-muted/30 font-mono text-xs"
                              />
                            </div>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </div>
                </section>

                {/* WebDAV / Nextcloud / NAS Configuration */}
                <section class="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
                  <div class="space-y-1">
                    <h3 class="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                      <span class="iconify mdi--folder-network size-4 text-blue-500" />
                      WebDAV / Nextcloud / NAS Storage
                    </h3>
                    <p class="text-xs text-muted-foreground">
                      Upload directly to your Nextcloud, ownCloud, Synology, QNAP, or any standard WebDAV server.
                    </p>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="space-y-1.5 md:col-span-2">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        WebDAV Endpoint URL
                      </label>
                      <Input
                        type="text"
                        value={formData().webdav_endpoint || ""}
                        placeholder="e.g. https://cloud.example.com/remote.php/dav/files/myuser/"
                        onInput={(e) => updateField("webdav_endpoint", e.currentTarget.value)}
                        class="bg-muted/30 font-mono text-xs"
                      />
                      <p class="text-[10px] text-muted-foreground">
                        Nextcloud WebDAV URL found in Files -&gt; Files settings -&gt; WebDAV.
                      </p>
                    </div>

                    <div class="space-y-1.5">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Username
                      </label>
                      <Input
                        type="text"
                        value={formData().webdav_username || ""}
                        placeholder="WebDAV username"
                        onInput={(e) => updateField("webdav_username", e.currentTarget.value)}
                        class="bg-muted/30 font-mono text-xs"
                      />
                    </div>

                    <div class="space-y-1.5">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Password / App Password
                      </label>
                      <Input
                        type="password"
                        value={formData().webdav_password || ""}
                        placeholder="WebDAV password or App Token"
                        onInput={(e) => updateField("webdav_password", e.currentTarget.value)}
                        class="bg-muted/30 font-mono text-xs"
                      />
                    </div>

                    <div class="space-y-1.5 md:col-span-2">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Destination Subfolder (Optional)
                      </label>
                      <Input
                        type="text"
                        value={formData().webdav_folder || ""}
                        placeholder="e.g. TwitchVODs or Archives/Streams"
                        onInput={(e) => updateField("webdav_folder", e.currentTarget.value)}
                        class="bg-muted/30 font-mono text-xs"
                      />
                      <p class="text-[10px] text-muted-foreground">
                        Automatically created via MKCOL if it does not already exist on the server.
                      </p>
                    </div>
                  </div>

                  <div class="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-border/40">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={webdavTesting()}
                      onClick={handleTestWebdav}
                      class="text-xs font-bold gap-1.5"
                    >
                      <span class={`iconify mdi--connection size-4 ${webdavTesting() ? "animate-spin" : ""}`} />
                      {webdavTesting() ? "Testing Connection..." : "Test WebDAV Connection"}
                    </Button>

                    <Show when={webdavTestStatus()}>
                      <p class="text-xs font-mono text-muted-foreground">
                        {webdavTestStatus()}
                      </p>
                    </Show>
                  </div>
                </section>
              </TabsContent>

              {/* Tab 4: Encoding */}
              <TabsContent value="encoding" class="space-y-6 outline-none animate-in fade-in duration-200">
                <section class="space-y-3 rounded-xl border border-border/60 bg-card/40 p-5">
                  <button
                    type="button"
                    aria-expanded={showEncodingBestPractices()}
                    onClick={() => setShowEncodingBestPractices(!showEncodingBestPractices())}
                    class="w-full text-left flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary hover:text-primary/80 transition-colors cursor-pointer"
                  >
                    <span
                      class={`iconify mdi--chevron-right size-3.5 transition-transform ${showEncodingBestPractices() ? "rotate-90" : ""}`}
                    />
                    Encoding best practices
                  </button>
                  <Show when={showEncodingBestPractices()}>
                    <div class="space-y-4 rounded-lg border border-border/50 bg-muted/20 p-3.5">
                      <div class="space-y-1.5">
                        <h4 class="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <span class="iconify mdi--youtube size-3.5 text-red-500" />
                          Best YouTube quality
                        </h4>
                        <ul class="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
                          <li>
                            Prefer <span class="font-semibold text-foreground">H.264 (x264)</span> — max
                            YouTube compatibility; HEVC is often re-encoded or rejected in some workflows.
                          </li>
                          <li>
                            CRF <span class="font-semibold text-foreground">18–20</span> for near-source
                            upload quality (lower = larger / better).
                          </li>
                          <li>
                            Avoid <span class="font-semibold text-foreground">Passthrough</span> unless
                            the source is already H.264 at a solid bitrate.
                          </li>
                          <li>
                            Upload a clean high-quality master; YouTube builds the ABR ladder from it.
                          </li>
                        </ul>
                      </div>
                      <div class="space-y-1.5">
                        <h4 class="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <span class="iconify mdi--lightning-bolt size-3.5 text-amber-400" />
                          Fastest / most efficient download &amp; store
                        </h4>
                        <ul class="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
                          <li>
                            Use <span class="font-semibold text-foreground">Passthrough</span> to keep the
                            Twitch source as-is — no re-encode, instant finish, disk = source size.
                          </li>
                          <li>
                            Long-term archive: <span class="font-semibold text-foreground">HEVC NVENC</span>{" "}
                            (or x265) + CRF <span class="font-semibold text-foreground">24–28</span> — small
                            files, fast with GPU.
                          </li>
                          <li>
                            Re-encode <span class="font-semibold text-foreground">once</span> after
                            download, then upload/archive that file — don't re-encode per destination.
                          </li>
                        </ul>
                      </div>
                    </div>
                  </Show>
                </section>

                <section class="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
                  <div class="space-y-1">
                    <h3 class="text-sm font-bold uppercase tracking-wider text-primary">
                      Video Compression & Transcoding
                    </h3>
                    <p class="text-xs text-muted-foreground">
                      Fine-tune encoder presets, CRF quality values, and audio parameters.
                    </p>
                  </div>

                  <div class="grid gap-5">
                    <div class="space-y-2">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Encoder Engine
                      </label>
                      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                        <For
                          each={[
                            {
                              id: "hevc_nvenc",
                              title: "HEVC NVENC",
                              sub: "NVIDIA GPU (Fastest & Smallest)",
                            },
                            {
                              id: "libx265",
                              title: "H.265 (x265)",
                              sub: "CPU (High Compression)",
                            },
                            {
                              id: "libx264",
                              title: "H.264 (x264)",
                              sub: "CPU (Maximum Compatibility)",
                            },
                            {
                              id: "passthrough",
                              title: "Passthrough",
                              sub: "Direct Remux (Instant, No Re-encode)",
                            },
                          ]}
                        >
                          {(preset) => (
                            <button
                              type="button"
                              onClick={() => updateField("encoder_preset", preset.id)}
                              class={`p-3 rounded-xl border text-left transition-all ${
                                formData().encoder_preset === preset.id
                                  ? "border-primary bg-primary/10 ring-1 ring-primary"
                                  : "border-border/60 bg-muted/20 hover:bg-muted/40"
                              }`}
                            >
                              <p class="text-xs font-bold text-foreground">{preset.title}</p>
                              <p class="text-[10px] text-muted-foreground mt-0.5">{preset.sub}</p>
                            </button>
                          )}
                        </For>
                      </div>
                    </div>

                    <div class="space-y-2">
                      <div class="flex items-center justify-between">
                        <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                          Constant Rate Factor (CRF) Quality
                        </label>
                        <span class="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                          CRF {formData().crf}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="16"
                        max="32"
                        value={formData().crf}
                        onInput={(e) => updateField("crf", Number(e.currentTarget.value))}
                        class="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                      />
                      <div class="flex justify-between text-[10px] text-muted-foreground">
                        <span>16 (Near Lossless / Largest)</span>
                        <span>24 (Recommended Balance)</span>
                        <span>32 (Smallest File)</span>
                      </div>
                    </div>
                  </div>
                </section>
              </TabsContent>

              {/* Tab 5: Accounts */}
              <TabsContent value="accounts" class="space-y-6 outline-none animate-in fade-in duration-200 pb-8">
                <section class="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
                  <div class="space-y-1">
                    <h3 class="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                      <span class="iconify mdi--account-check size-4" />
                      Connected Accounts & Integrations
                    </h3>
                    <p class="text-xs text-muted-foreground">
                      Own Client ID + Secret required (fields below or env). Redirects: Twitch :17563 · YouTube :17564 · Drive :17565
                    </p>
                  </div>

                  <div class="sticky top-0 z-10 -mx-1 px-1 py-2 bg-card/95 backdrop-blur-sm border-b border-border/40 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={twitchLoggingIn()}
                      onClick={handleLoginTwitch}
                      class="bg-[#9146FF] hover:bg-[#772ce8] text-white font-bold gap-2 text-xs"
                    >
                      <span class={`iconify mdi--twitch size-4 ${twitchLoggingIn() ? "animate-spin" : ""}`} />
                      {formData().twitch_access_token ? "Re-auth Twitch" : "Login Twitch"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={youtubeLoggingIn()}
                      onClick={handleLoginYouTube}
                      class="bg-red-600 hover:bg-red-700 text-white font-bold gap-2 text-xs"
                    >
                      <span class={`iconify mdi--youtube size-4 ${youtubeLoggingIn() ? "animate-spin" : ""}`} />
                      {formData().youtube_access_token ? "Re-auth YouTube" : "Login YouTube"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={gdriveLoggingIn()}
                      onClick={handleLoginGdrive}
                      class="bg-amber-600 hover:bg-amber-700 text-white font-bold gap-2 text-xs"
                    >
                      <span class={`iconify mdi--google-drive size-4 ${gdriveLoggingIn() ? "animate-spin" : ""}`} />
                      {formData().gdrive_access_token ? "Re-auth Drive" : "Connect Drive"}
                    </Button>
                  </div>

                  <div class="grid gap-4">
                    {/* Twitch Account Card */}
                    <div class="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-3">
                      <div class="flex items-start justify-between gap-3">
                        <div class="flex items-center gap-3">
                          <div class="flex size-10 items-center justify-center rounded-xl bg-[#9146FF]/20 text-[#9146FF] shrink-0">
                            <span class="iconify mdi--twitch size-6" />
                          </div>
                          <div>
                            <div class="flex items-center gap-2">
                              <h4 class="text-sm font-bold text-foreground">Twitch Channel</h4>
                              <Show
                                when={formData().twitch_access_token}
                                fallback={
                                  <span class="text-[10px] font-bold text-muted-foreground bg-muted/60 px-2 py-0.5 rounded">
                                    Not Connected
                                  </span>
                                }
                              >
                                <span class="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                                  <span class="iconify mdi--check size-3" />
                                  {props.twitchUser ? `@${props.twitchUser.login}` : "Connected"}
                                </span>
                              </Show>
                            </div>
                            <p class="text-xs text-muted-foreground">
                              Browse broadcast archives, fetch chat replay logs, and queue automated downloads.
                            </p>
                          </div>
                        </div>

                        <Show when={props.twitchUser}>
                          <div class="hidden sm:flex items-center gap-2 bg-card/60 border border-border/40 rounded-full pl-1.5 pr-3 py-1 shrink-0">
                            <img
                              src={props.twitchUser!.profile_image_url}
                              alt={props.twitchUser!.display_name}
                              class="size-6 rounded-full object-cover border border-primary/30"
                            />
                            <span class="text-xs font-semibold text-foreground">
                              {props.twitchUser!.display_name}
                            </span>
                          </div>
                        </Show>
                      </div>

                      <div class="pt-2 flex flex-wrap items-center gap-3 border-t border-border/30">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          disabled={twitchLoggingIn()}
                          onClick={handleLoginTwitch}
                          class="bg-[#9146FF] hover:bg-[#772ce8] text-white font-bold gap-2 text-xs"
                        >
                          <span class={`iconify mdi--twitch size-4 ${twitchLoggingIn() ? "animate-spin" : ""}`} />
                          {twitchLoggingIn()
                            ? "Opening Browser Auth..."
                            : formData().twitch_access_token
                            ? "Re-authenticate Twitch"
                            : "Login with Twitch"}
                        </Button>

                        <Show when={formData().twitch_access_token}>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleDisconnectTwitch}
                            class="text-xs text-destructive hover:bg-destructive/10"
                          >
                            Disconnect
                          </Button>
                        </Show>
                      </div>

                      <div class="pt-1">
                        <button
                          type="button"
                          onClick={() => setShowAdvancedTwitch(!showAdvancedTwitch())}
                          class="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <span class={`iconify mdi--chevron-right size-3.5 transition-transform ${showAdvancedTwitch() ? "rotate-90" : ""}`} />
                          Twitch Developer Credentials (required for login)
                        </button>

                        <Show when={showAdvancedTwitch()}>
                          <div class="mt-3 p-3.5 rounded-lg border border-border/50 bg-muted/20 space-y-3">
                            <p class="text-[10px] text-muted-foreground">
                              Twitch login needs your own{" "}
                              <a
                                href="https://dev.twitch.tv/console/apps"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="underline hover:text-foreground"
                              >
                                Twitch Developer Console
                              </a>{" "}
                              application. Add this OAuth Redirect URL exactly (http, no trailing slash):
                            </p>
                            <code class="block text-[10px] font-mono bg-muted/40 px-2 py-1.5 rounded break-all select-all">
                              http://localhost:17563/auth/callback
                            </code>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div class="space-y-1">
                                <label class="text-[10px] font-bold text-muted-foreground uppercase">
                                  Twitch Client ID
                                </label>
                                <Input
                                  type="text"
                                  value={formData().twitch_client_id}
                                  placeholder="Twitch Client ID"
                                  onInput={(e) => updateField("twitch_client_id", e.currentTarget.value)}
                                  class="bg-muted/30 font-mono text-xs"
                                />
                              </div>
                              <div class="space-y-1">
                                <label class="text-[10px] font-bold text-muted-foreground uppercase">
                                  Twitch Client Secret
                                </label>
                                <Input
                                  type="password"
                                  value={formData().twitch_client_secret}
                                  placeholder="Twitch Client Secret"
                                  onInput={(e) => updateField("twitch_client_secret", e.currentTarget.value)}
                                  class="bg-muted/30 font-mono text-xs"
                                />
                              </div>
                            </div>
                          </div>
                        </Show>
                      </div>
                    </div>

                    {/* YouTube Account Card */}
                    <div class="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-3">
                      <div class="flex items-start justify-between gap-3">
                        <div class="flex items-center gap-3">
                          <div class="flex size-10 items-center justify-center rounded-xl bg-red-500/20 text-red-500 shrink-0">
                            <span class="iconify mdi--youtube size-6" />
                          </div>
                          <div>
                            <div class="flex items-center gap-2">
                              <h4 class="text-sm font-bold text-foreground">YouTube Channel</h4>
                              <Show
                                when={formData().youtube_access_token}
                                fallback={
                                  <span class="text-[10px] font-bold text-muted-foreground bg-muted/60 px-2 py-0.5 rounded">
                                    Not Connected
                                  </span>
                                }
                              >
                                <span class="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                                  <span class="iconify mdi--check size-3" /> Connected & Ready
                                </span>
                              </Show>
                            </div>
                            <p class="text-xs text-muted-foreground">
                              Publish processed broadcasts directly to your YouTube channel in 1 click.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div class="pt-2 flex flex-wrap items-center gap-3 border-t border-border/30">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          disabled={youtubeLoggingIn()}
                          onClick={handleLoginYouTube}
                          class="bg-red-600 hover:bg-red-700 text-white font-bold gap-2 text-xs"
                        >
                          <span class={`iconify mdi--youtube size-4 ${youtubeLoggingIn() ? "animate-spin" : ""}`} />
                          {youtubeLoggingIn()
                            ? "Opening Browser Auth..."
                            : formData().youtube_access_token
                            ? "Re-authenticate YouTube"
                            : "Login with YouTube"}
                        </Button>

                        <Show when={formData().youtube_access_token}>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleDisconnectYouTube}
                            class="text-xs text-destructive hover:bg-destructive/10"
                          >
                            Disconnect
                          </Button>
                        </Show>
                      </div>

                      <div class="pt-1">
                        <button
                          type="button"
                          onClick={() => setShowAdvancedYouTube(!showAdvancedYouTube())}
                          class="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <span class={`iconify mdi--chevron-right size-3.5 transition-transform ${showAdvancedYouTube() ? "rotate-90" : ""}`} />
                          YouTube Google Cloud Credentials (required for login)
                        </button>

                        <Show when={showAdvancedYouTube()}>
                          <div class="mt-3 p-3.5 rounded-lg border border-border/50 bg-muted/20 space-y-3">
                            <p class="text-[10px] text-muted-foreground">
                              Create a Desktop OAuth client in Google Cloud Console. Redirect URI exactly:
                            </p>
                            <code class="block text-[10px] font-mono bg-muted/40 px-2 py-1.5 rounded break-all select-all">
                              http://localhost:17564/auth/callback
                            </code>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div class="space-y-1">
                                <label class="text-[10px] font-bold text-muted-foreground uppercase">
                                  Google Client ID
                                </label>
                                <Input
                                  type="text"
                                  value={formData().youtube_client_id || ""}
                                  placeholder="Google Client ID"
                                  onInput={(e) => updateField("youtube_client_id", e.currentTarget.value)}
                                  class="bg-muted/30 font-mono text-xs"
                                />
                              </div>
                              <div class="space-y-1">
                                <label class="text-[10px] font-bold text-muted-foreground uppercase">
                                  Google Client Secret
                                </label>
                                <Input
                                  type="password"
                                  value={formData().youtube_client_secret || ""}
                                  placeholder="Google Client Secret"
                                  onInput={(e) => updateField("youtube_client_secret", e.currentTarget.value)}
                                  class="bg-muted/30 font-mono text-xs"
                                />
                              </div>
                            </div>
                          </div>
                        </Show>
                      </div>
                    </div>

                    {/* Google Drive Account Card */}
                    <div class="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-3">
                      <div class="flex items-start justify-between gap-3">
                        <div class="flex items-center gap-3">
                          <div class="flex size-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-500 shrink-0">
                            <span class="iconify mdi--google-drive size-6" />
                          </div>
                          <div>
                            <div class="flex items-center gap-2">
                              <h4 class="text-sm font-bold text-foreground">Google Drive Storage</h4>
                              <Show
                                when={formData().gdrive_access_token}
                                fallback={
                                  <span class="text-[10px] font-bold text-muted-foreground bg-muted/60 px-2 py-0.5 rounded">
                                    Not Connected
                                  </span>
                                }
                              >
                                <span class="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                                  <span class="iconify mdi--check size-3" /> Connected
                                </span>
                              </Show>
                            </div>
                            <p class="text-xs text-muted-foreground">
                              Upload and archive full stream recordings to Google Drive with resumable 8 MB chunked transfers.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div class="pt-2 flex flex-wrap items-center gap-3 border-t border-border/30">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          disabled={gdriveLoggingIn()}
                          onClick={handleLoginGdrive}
                          class="bg-amber-600 hover:bg-amber-700 text-white font-bold gap-2 text-xs"
                        >
                          <span class={`iconify mdi--google-drive size-4 ${gdriveLoggingIn() ? "animate-spin" : ""}`} />
                          {gdriveLoggingIn()
                            ? "Opening Browser Auth..."
                            : formData().gdrive_access_token
                            ? "Re-authenticate Drive"
                            : "Connect Google Drive"}
                        </Button>

                        <Show when={formData().gdrive_access_token}>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleDisconnectGdrive}
                            class="text-xs text-destructive hover:bg-destructive/10"
                          >
                            Disconnect
                          </Button>
                        </Show>
                      </div>
                    </div>
                  </div>
                </section>
              </TabsContent>

              {/* Tab: Cloud Worker (VPS) */}
              <TabsContent value="worker" class="space-y-6 outline-none animate-in fade-in duration-200">
                {/* Connection Section */}
                <section class="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
                  <div class="space-y-1">
                    <h3 class="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                      <span class="iconify mdi--server-network size-4" />
                      VPS Cloud Worker Connection
                    </h3>
                    <p class="text-xs text-muted-foreground">
                      Connect your self-hosted background worker running on your VPS or remote server.
                    </p>
                  </div>

                  <div class="grid gap-4">
                    <div class="space-y-1.5">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Worker Server URL
                      </label>
                      <Input
                        type="text"
                        value={formData().worker_url || ""}
                        placeholder="e.g. http://192.168.1.100:4000 or https://worker.example.com"
                        onInput={(e) => updateField("worker_url", e.currentTarget.value)}
                        class="bg-muted/30 font-mono text-xs"
                      />
                      <p class="text-[10px] text-muted-foreground">
                        The public or LAN endpoint where your Docker container / Rust binary is listening.
                      </p>
                    </div>

                    <div class="space-y-1.5">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        API Key / Bearer Secret
                      </label>
                      <Input
                        type="password"
                        value={formData().worker_api_key || ""}
                        placeholder="API_KEY configured in worker .env (optional)"
                        onInput={(e) => updateField("worker_api_key", e.currentTarget.value)}
                        class="bg-muted/30 font-mono text-xs"
                      />
                      <p class="text-[10px] text-muted-foreground">
                        Required if authentication is enabled on the VPS worker.
                      </p>
                    </div>

                    <div class="space-y-1.5">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Max local storage (GB)
                      </label>
                      <Input
                        type="number"
                        min="1"
                        value={formData().max_storage_gb ?? 100}
                        onInput={(e) => {
                          const n = parseInt(e.currentTarget.value, 10);
                          updateField("max_storage_gb", Number.isFinite(n) && n >= 1 ? n : 100);
                        }}
                        class="bg-muted/30 font-mono text-xs"
                      />
                      <p class="text-[10px] text-muted-foreground">
                        Cap for files in the worker completed folder. New jobs are refused when full. Sync to apply.
                      </p>
                    </div>

                    <div class="flex items-center gap-3 pt-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={workerTesting() || !formData().worker_url}
                        onClick={handleTestWorker}
                        class="gap-1.5 text-xs font-semibold"
                      >
                        <span class={`iconify mdi--lan-connect size-3.5 ${workerTesting() ? "animate-spin" : ""}`} />
                        {workerTesting() ? "Testing Connection..." : "Test Worker Connection"}
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={workerSyncing() || !formData().worker_url}
                        onClick={handleSyncWorker}
                        class="gap-1.5 text-xs font-semibold"
                      >
                        <span class={`iconify mdi--sync size-3.5 ${workerSyncing() ? "animate-spin" : ""}`} />
                        {workerSyncing() ? "Syncing..." : "Sync Settings to VPS"}
                      </Button>
                    </div>

                    <Show when={workerTestStatus()}>
                      <div class={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                        workerStatusData()
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : "bg-destructive/10 border-destructive/30 text-destructive"
                      }`}>
                        <span class={`iconify size-4 shrink-0 mt-0.5 ${
                          workerStatusData() ? "mdi--check-circle" : "mdi--alert-circle"
                        }`} />
                        <div class="space-y-1">
                          <p class="font-medium">{workerTestStatus()}</p>
                          <Show when={workerStatusData()}>
                            <p class="text-[11px] opacity-80">
                              CPU: {workerStatusData()?.cpu_usage_percent.toFixed(1)}% •
                              RAM: {workerStatusData()?.memory_used_mb}MB / {workerStatusData()?.memory_total_mb}MB •
                              Active Jobs: {workerStatusData()?.active_jobs_count} •
                              Storage: {(workerStatusData()?.storage_free_gb ?? 0).toFixed(1)}GB free of {workerStatusData()?.storage_max_gb ?? 100}GB
                              <span class="opacity-70"> (host disk {(workerStatusData()?.disk_free_gb ?? 0).toFixed(1)}GB free)</span>
                            </p>
                            <p class="text-[11px] opacity-80">
                              Creds: Twitch {workerStatusData()?.has_twitch ? "ok" : "—"} ·
                              S3 {workerStatusData()?.has_s3 ? "ok" : "—"} ·
                              GDrive {workerStatusData()?.has_gdrive ? "ok" : "—"} ·
                              WebDAV {workerStatusData()?.has_webdav ? "ok" : "—"}
                            </p>
                          </Show>
                        </div>
                      </div>
                    </Show>
                  </div>
                </section>

                {/* Autonomous Watcher Section */}
                <section class="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
                  <div class="space-y-1">
                    <h3 class="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                      <span class="iconify mdi--eye-check-outline size-4" />
                      Autonomous Channel Watcher (24/7 VPS Background Archival)
                    </h3>
                    <p class="text-xs text-muted-foreground">
                      Let your VPS monitor your channel 24/7. When a live stream ends, the worker automatically downloads, encodes, and archives the VOD without needing this desktop app running.
                    </p>
                  </div>

                  <div class="space-y-4">
                    <label class="flex items-start gap-3 p-3 rounded-lg border border-border/60 bg-muted/20 cursor-pointer hover:bg-muted/30 transition-colors">
                      <input
                        type="checkbox"
                        checked={formData().auto_archive_enabled || false}
                        onChange={(e) => updateField("auto_archive_enabled", e.currentTarget.checked)}
                        class="mt-0.5 rounded border-border text-primary focus:ring-primary size-4"
                      />
                      <div class="space-y-0.5">
                        <span class="text-xs font-semibold text-foreground">
                          Enable 24/7 Autonomous Archiving
                        </span>
                        <p class="text-[11px] text-muted-foreground">
                          The worker server will autonomously poll Twitch periodically and queue any newly finished broadcast archive.
                        </p>
                      </div>
                    </label>

                    <div class="space-y-1.5 max-w-xs">
                      <label class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Polling Interval (Minutes)
                      </label>
                      <Input
                        type="number"
                        min="1"
                        max="1440"
                        value={formData().auto_archive_interval_mins || 15}
                        onInput={(e) => {
                          const val = parseInt(e.currentTarget.value, 10);
                          updateField("auto_archive_interval_mins", isNaN(val) ? 15 : val);
                        }}
                        class="bg-muted/30 font-mono text-xs w-36"
                      />
                      <p class="text-[10px] text-muted-foreground">
                        Recommended: 15 minutes. (Minimum 1 minute).
                      </p>
                    </div>
                  </div>
                </section>

                {/* VPS Deployment Info Box */}
                <section class="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2">
                  <div class="flex items-center gap-2 text-xs font-bold text-primary">
                    <span class="iconify mdi--information-outline size-4" />
                    How to deploy your VPS worker
                  </div>
                  <p class="text-[11px] text-muted-foreground leading-relaxed">
                    Deploying the worker takes less than 2 minutes via Docker Compose on any Ubuntu / Debian VPS. Open the <strong>Cloud Workers</strong> tab in the sidebar and click <strong>Setup Guide</strong> for step-by-step instructions.
                  </p>
                </section>
              </TabsContent>

              {/* Tab: Data & TOML Import/Export */}
              <TabsContent value="toml" class="space-y-6 outline-none animate-in fade-in duration-200">
                <section class="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
                  <div class="space-y-1">
                    <h3 class="text-sm font-bold uppercase tracking-wider text-primary">
                      TOML Configuration & Backup
                    </h3>
                    <p class="text-xs text-muted-foreground">
                      Import, export, or edit your complete settings file using standard human-readable TOML.
                    </p>
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleImportTomlFile}
                      class="h-12 flex flex-col items-center justify-center gap-1 border-border/70 hover:bg-muted/40"
                    >
                      <div class="flex items-center gap-1.5 font-bold text-xs">
                        <span class="iconify mdi--upload size-4 text-primary" />
                        Import TOML File
                      </div>
                      <span class="text-[10px] text-muted-foreground">Load settings from .toml</span>
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleExportTomlFile}
                      class="h-12 flex flex-col items-center justify-center gap-1 border-border/70 hover:bg-muted/40"
                    >
                      <div class="flex items-center gap-1.5 font-bold text-xs">
                        <span class="iconify mdi--download size-4 text-emerald-400" />
                        Export TOML File
                      </div>
                      <span class="text-[10px] text-muted-foreground">Save backup to disk</span>
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleOpenRawTomlModal}
                      class="h-12 flex flex-col items-center justify-center gap-1 border-border/70 hover:bg-muted/40"
                    >
                      <div class="flex items-center gap-1.5 font-bold text-xs">
                        <span class="iconify mdi--code-braces size-4 text-blue-400" />
                        Paste / Edit Raw TOML
                      </div>
                      <span class="text-[10px] text-muted-foreground">Direct editor dialog</span>
                    </Button>
                  </div>

                  <div class="space-y-2 pt-2">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Current settings.toml
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(liveToml());
                          toast.success("TOML copied to clipboard!");
                        }}
                        class="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <span class="iconify mdi--content-copy size-3" />
                        Copy
                      </Button>
                    </div>
                    <pre class="p-4 rounded-xl bg-muted/40 border border-border/40 font-mono text-[11px] leading-relaxed text-foreground/80 overflow-x-auto max-h-56">
                      {liveToml() || "Loading…"}
                    </pre>
                  </div>
                </section>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>

      {/* Raw TOML Edit/Paste Dialog */}
      <Dialog open={rawTomlOpen()} onOpenChange={setRawTomlOpen}>
        <DialogContent class="sm:max-w-2xl bg-card/95 backdrop-blur-xl border-border/80 shadow-2xl">
          <DialogHeader>
            <DialogTitle class="text-base font-bold font-heading flex items-center gap-2">
              <span class="iconify mdi--code-braces size-5 text-primary" />
              Raw TOML Settings Editor
            </DialogTitle>
            <DialogDescription class="text-xs text-muted-foreground">
              Review or paste your TOML configuration below. Pressing Apply will validate and update your settings immediately.
            </DialogDescription>
          </DialogHeader>

          <div class="py-2">
            <textarea
              rows={14}
              value={rawTomlContent()}
              onInput={(e) => setRawTomlContent(e.currentTarget.value)}
              class="w-full rounded-xl border border-border/60 bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="# Paste settings.toml content here..."
            />
          </div>

          <DialogFooter class="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRawTomlOpen(false)}
              class="text-xs"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={tomlApplying()}
              onClick={handleApplyRawToml}
              class="text-xs font-bold"
            >
              <span class="iconify mdi--check mr-1 size-3.5" />
              {tomlApplying() ? "Validating & Applying..." : "Apply TOML Configuration"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UpdateDialog
        open={updateOpen()}
        onOpenChange={setUpdateOpen}
        updateInfo={updateInfo()}
      />
    </div>
  );
};
