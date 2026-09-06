import type { Component } from "solid-js";
import { createEffect, createSignal, onCleanup, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  formatApproxDuration,
  formatSecondsToTimestamp,
  parseTimestampToSeconds,
  parseTwitchDuration,
} from "~/lib/utils";
import { estimateJobDuration, parseResolutionAndFps } from "~/lib/estimation";
import { getQualities, workerGetStatus } from "~/services/tauri";
import type {
  SystemHardwareInfo,
  TwitchVod,
  VodQuality,
  WorkerStatus,
  YouTubeVideoMetadata,
} from "~/types";

export interface ArchiveModalConfirmConfig {
  target: "local" | "worker";
  vodId: string;
  title: string;
  playlistUrl: string;
  preset: string;
  crf: number;
  startSecs?: number;
  endSecs?: number;
  saveLocal: boolean;
  uploadToS3: boolean;
  uploadToGdrive?: boolean;
  uploadToWebdav?: boolean;
  uploadToYouTube: boolean;
  youtubeMetadata?: YouTubeVideoMetadata;
  deleteFromTwitchAfter: boolean;
}

export interface ArchiveModalProps {
  vod: TwitchVod | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (config: ArchiveModalConfirmConfig) => void;
  defaultPreset?: string;
  defaultCrf?: number;
  hasWorkerConfigured?: boolean;
  hasS3Configured?: boolean;
  hasGdriveConfigured?: boolean;
  hasWebdavConfigured?: boolean;
  hasYouTubeConfigured?: boolean;
  currentUserId?: string;
  localHardware?: SystemHardwareInfo | null;
  workerStatus?: WorkerStatus | null;
  workerUrl?: string;
  workerApiKey?: string;
}

export const ArchiveModal: Component<ArchiveModalProps> = (props) => {
  const [target, setTarget] = createSignal<"local" | "worker">("local");
  const [qualities, setQualities] = createSignal<VodQuality[]>([]);
  const [selectedQualityUrl, setSelectedQualityUrl] = createSignal("");
  const [fetchedWorkerStatus, setFetchedWorkerStatus] = createSignal<WorkerStatus | null>(null);

  // Determine initial preset based on hardware if no default specified
  const initialPreset = () => {
    if (props.defaultPreset) return props.defaultPreset;
    if (props.localHardware?.has_nvenc) return "hevc_nvenc";
    if (props.localHardware?.has_amf) return "hevc_amf";
    if (props.localHardware?.has_qsv) return "hevc_qsv";
    return "libx264";
  };

  const [preset, setPreset] = createSignal(initialPreset());
  const [crf, setCrf] = createSignal(props.defaultCrf || 24);

  // Auto-adapt preset if local hardware has specific GPU and no default preset was set
  createEffect(() => {
    if (!props.defaultPreset && props.localHardware) {
      if (props.localHardware.has_amf && !props.localHardware.has_nvenc) {
        setPreset("hevc_amf");
      } else if (props.localHardware.has_nvenc) {
        setPreset("hevc_nvenc");
      } else if (props.localHardware.has_qsv) {
        setPreset("hevc_qsv");
      }
    }
  });

  // Fetch worker status if targeting worker and workerUrl provided
  createEffect(() => {
    if (props.isOpen && target() === "worker" && props.workerUrl && !fetchedWorkerStatus()) {
      workerGetStatus(props.workerUrl, props.workerApiKey).match(
        (st) => setFetchedWorkerStatus(st),
        () => {},
      );
    }
  });

  const activeWorkerStatus = () => fetchedWorkerStatus() || props.workerStatus;

  const activeHardwareHasNvenc = () =>
    target() === "local" ? Boolean(props.localHardware?.has_nvenc) : Boolean(activeWorkerStatus()?.has_nvenc);

  const activeHardwareHasAmf = () =>
    target() === "local" ? Boolean(props.localHardware?.has_amf) : Boolean(activeWorkerStatus()?.has_amf);

  const activeHardwareHasQsv = () =>
    target() === "local" ? Boolean(props.localHardware?.has_qsv) : Boolean(activeWorkerStatus()?.has_qsv);

  // Configurable Destinations
  const [uploadToS3, setUploadToS3] = createSignal(false);
  const [uploadToGdrive, setUploadToGdrive] = createSignal(false);
  const [uploadToWebdav, setUploadToWebdav] = createSignal(false);
  const [saveLocal, setSaveLocal] = createSignal(true);
  const [uploadToYouTube, setUploadToYouTube] = createSignal(false);
  const [deleteFromTwitch, setDeleteFromTwitch] = createSignal(false);
  const isOwnVod = () =>
    Boolean(
      props.currentUserId &&
      props.vod?.user_id &&
      props.vod.user_id === props.currentUserId
    );

  // Trimming & Preview state
  const [showPreview, setShowPreview] = createSignal(true);
  const [startInput, setStartInput] = createSignal("");
  const [stopInput, setStopInput] = createSignal("");
  const [playerCurrentTime, setPlayerCurrentTime] = createSignal(0);
  const [playerTargetTimeSecs, setPlayerTargetTimeSecs] = createSignal<number | null>(null);
  const [useIframeFallback, setUseIframeFallback] = createSignal(false);

  let embedContainerRef: HTMLDivElement | undefined;
  let twitchPlayerInstance: any = null;
  let playerPollInterval: any = null;

  const rawVodDurationSecs = () =>
    props.vod?.duration ? parseTwitchDuration(props.vod.duration) : 0;

  const parsedStartSecs = () => parseTimestampToSeconds(startInput(), "minutes");
  const parsedEndSecs = () => parseTimestampToSeconds(stopInput(), "minutes");

  const isTrimmed = () => parsedStartSecs() !== null || parsedEndSecs() !== null;

  const effectiveDurationSecs = () => {
    const total = rawVodDurationSecs();
    const start = parsedStartSecs() ?? 0;
    const end = parsedEndSecs() !== null ? Math.min(parsedEndSecs()!, total) : total;
    return Math.max(end - start, 0);
  };

  const trimError = () => {
    const s = parsedStartSecs();
    const e = parsedEndSecs();
    const total = rawVodDurationSecs();
    if (s !== null && total > 0 && s > total) {
      return `Start time (${formatSecondsToTimestamp(s)}) exceeds total stream length (${formatSecondsToTimestamp(total)}).`;
    }
    if (e !== null && total > 0 && e > total) {
      return `Stop time (${formatSecondsToTimestamp(e)}) exceeds total stream length (${formatSecondsToTimestamp(total)}).`;
    }
    if (s !== null && e !== null && s >= e) {
      return `Start time (${formatSecondsToTimestamp(s)}) must be earlier than stop time (${formatSecondsToTimestamp(e)}).`;
    }
    return "";
  };

  const durationSecs = () => (isTrimmed() ? effectiveDurationSecs() : rawVodDurationSecs());

  const selectedQuality = () =>
    qualities().find((q) => q.url === selectedQualityUrl());

  const parsedQuality = () =>
    parseResolutionAndFps(
      selectedQuality()?.resolution,
      selectedQuality()?.fps,
      selectedQuality()?.name,
    );

  const estimation = () =>
    estimateJobDuration({
      durationSecs: durationSecs(),
      preset: preset(),
      crf: crf(),
      qualityResolution: selectedQuality()?.resolution,
      qualityFps: selectedQuality()?.fps,
      qualityBandwidth: selectedQuality()?.bandwidth,
      target: target(),
      localHardware: props.localHardware,
      workerStatus: activeWorkerStatus(),
      destinations: {
        saveLocal: saveLocal(),
        uploadToS3: uploadToS3(),
        uploadToGdrive: uploadToGdrive(),
        uploadToWebdav: uploadToWebdav(),
        uploadToYouTube: uploadToYouTube(),
      },
    });

  // YouTube Metadata
  const [ytTitle, setYtTitle] = createSignal("");
  const [ytPrivacy, setYtPrivacy] = createSignal<"private" | "unlisted" | "public">("unlisted");
  const [ytTags, setYtTags] = createSignal("Twitch, VOD, Stream");

  const [loadingQualities, setLoadingQualities] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal("");

  const hasSelectedDestination = () =>
    saveLocal() ||
    Boolean(props.hasS3Configured && uploadToS3()) ||
    Boolean(props.hasGdriveConfigured && uploadToGdrive()) ||
    Boolean(props.hasWebdavConfigured && uploadToWebdav()) ||
    Boolean(props.hasYouTubeConfigured && uploadToYouTube());

  const hasAnyCloudConfigured = () =>
    Boolean(
      props.hasS3Configured ||
      props.hasGdriveConfigured ||
      props.hasWebdavConfigured ||
      props.hasYouTubeConfigured
    );

  const initTwitchPlayer = () => {
    if (!props.isOpen || !props.vod?.id || !embedContainerRef) return;

    const win = window as any;
    const createPlayer = () => {
      if (!win.Twitch?.Player || !embedContainerRef) {
        setUseIframeFallback(true);
        return;
      }
      try {
        if (twitchPlayerInstance) {
          try {
            twitchPlayerInstance.destroy?.();
          } catch {}
          twitchPlayerInstance = null;
        }
        embedContainerRef.innerHTML = "";
        const player = new win.Twitch.Player(embedContainerRef, {
          video: props.vod!.id,
          parent: [window.location.hostname || "localhost", "localhost", "tauri.localhost"],
          width: "100%",
          height: "100%",
          autoplay: false,
        });
        twitchPlayerInstance = player;
        setUseIframeFallback(false);

        if (playerPollInterval) clearInterval(playerPollInterval);
        playerPollInterval = setInterval(() => {
          if (twitchPlayerInstance && typeof twitchPlayerInstance.getCurrentTime === "function") {
            try {
              const t = twitchPlayerInstance.getCurrentTime();
              if (typeof t === "number" && !isNaN(t)) {
                setPlayerCurrentTime(Math.floor(t));
              }
            } catch {}
          }
        }, 500);
      } catch {
        setUseIframeFallback(true);
      }
    };

    if (win.Twitch?.Player) {
      createPlayer();
    } else {
      const existingScript = document.getElementById("twitch-embed-sdk");
      if (!existingScript) {
        const script = document.createElement("script");
        script.id = "twitch-embed-sdk";
        script.src = "https://player.twitch.tv/js/embed/v1.js";
        script.async = true;
        script.onload = () => createPlayer();
        script.onerror = () => setUseIframeFallback(true);
        document.head.appendChild(script);
      } else {
        existingScript.addEventListener("load", () => createPlayer());
      }
      setTimeout(() => {
        if (!twitchPlayerInstance) {
          setUseIframeFallback(true);
        }
      }, 1500);
    }
  };

  createEffect(() => {
    const v = props.vod;
    if (props.isOpen && v) {
      setLoadingQualities(true);
      setErrorMsg("");
      setYtTitle(`[VOD] ${v.title}`);
      setStartInput("");
      setStopInput("");
      setPlayerCurrentTime(0);
      setPlayerTargetTimeSecs(null);

      // Default to worker if configured and preferred
      if (props.hasWorkerConfigured) {
        setTarget("worker");
      } else {
        setTarget("local");
      }

      // Initialize destination selections based on what is actually configured
      setUploadToS3(Boolean(props.hasS3Configured));
      setUploadToGdrive(Boolean(!props.hasS3Configured && props.hasGdriveConfigured));
      setUploadToWebdav(
        Boolean(!props.hasS3Configured && !props.hasGdriveConfigured && props.hasWebdavConfigured),
      );
      setSaveLocal(true);
      setUploadToYouTube(false);
      setDeleteFromTwitch(false);

      getQualities(v.id).match(
        (list) => {
          setQualities(list);
          if (list.length > 0) {
            setSelectedQualityUrl(list[0].url);
          }
          setLoadingQualities(false);
        },
        (err) => {
          setErrorMsg(err.message);
          setLoadingQualities(false);
        },
      );

      setTimeout(() => initTwitchPlayer(), 60);
    } else {
      if (playerPollInterval) {
        clearInterval(playerPollInterval);
        playerPollInterval = null;
      }
      if (twitchPlayerInstance) {
        try {
          twitchPlayerInstance.destroy?.();
        } catch {}
        twitchPlayerInstance = null;
      }
    }
  });

  onCleanup(() => {
    if (playerPollInterval) clearInterval(playerPollInterval);
    if (twitchPlayerInstance) {
      try {
        twitchPlayerInstance.destroy?.();
      } catch {}
      twitchPlayerInstance = null;
    }
  });

  const seekPlayer = (targetSecs: number) => {
    const maxDur = rawVodDurationSecs() || 86400;
    const clamped = Math.max(0, Math.min(targetSecs, maxDur));
    setPlayerCurrentTime(Math.floor(clamped));
    if (twitchPlayerInstance && typeof twitchPlayerInstance.seek === "function") {
      try {
        twitchPlayerInstance.seek(clamped);
        twitchPlayerInstance.play();
        return;
      } catch {}
    }
    setPlayerTargetTimeSecs(clamped);
  };

  const jumpDelta = (deltaSecs: number) => {
    seekPlayer(playerCurrentTime() + deltaSecs);
  };

  const handleSetStartFromPlayer = () => {
    setStartInput(formatSecondsToTimestamp(playerCurrentTime(), rawVodDurationSecs() >= 3600));
  };

  const handleSetStopFromPlayer = () => {
    setStopInput(formatSecondsToTimestamp(playerCurrentTime(), rawVodDurationSecs() >= 3600));
  };

  const handlePreviewStart = () => {
    const s = parsedStartSecs();
    if (s !== null) seekPlayer(s);
  };

  const handlePreviewStop = () => {
    const e = parsedEndSecs();
    if (e !== null) seekPlayer(e);
  };

  const handleResetTrim = () => {
    setStartInput("");
    setStopInput("");
    seekPlayer(0);
  };

  const handleStart = () => {
    if (!props.vod || !selectedQualityUrl() || !hasSelectedDestination() || Boolean(trimError())) return;

    const doUploadS3 = Boolean(props.hasS3Configured && uploadToS3());
    const doUploadGdrive = Boolean(props.hasGdriveConfigured && uploadToGdrive());
    const doUploadWebdav = Boolean(props.hasWebdavConfigured && uploadToWebdav());
    const doUploadYouTube = Boolean(props.hasYouTubeConfigured && uploadToYouTube());
    const doDeleteFromTwitch = Boolean(isOwnVod() && deleteFromTwitch());

    const ytMeta: YouTubeVideoMetadata | undefined = doUploadYouTube
      ? {
          title: ytTitle() || props.vod.title,
          description: `Twitch broadcast archive for ${props.vod.title}.\nOriginally streamed on Twitch.\n\n#Twitch #VOD`,
          privacy_status: ytPrivacy(),
          tags: ytTags()
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }
      : undefined;

    props.onConfirm({
      target: props.hasWorkerConfigured ? target() : "local",
      vodId: props.vod.id,
      title: props.vod.title,
      playlistUrl: selectedQualityUrl(),
      preset: preset(),
      crf: crf(),
      startSecs: parsedStartSecs() ?? undefined,
      endSecs: parsedEndSecs() ?? undefined,
      saveLocal: saveLocal(),
      uploadToS3: doUploadS3,
      uploadToGdrive: doUploadGdrive,
      uploadToWebdav: doUploadWebdav,
      uploadToYouTube: doUploadYouTube,
      youtubeMetadata: ytMeta,
      deleteFromTwitchAfter: doDeleteFromTwitch,
    });
    props.onClose();
  };

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent class="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <span class="i-mdi-cloud-upload text-primary size-5" aria-hidden="true" />
            Archive Stream Broadcast
          </DialogTitle>
          <DialogDescription class="line-clamp-1">
            {props.vod?.title || "Configure download, compression, and archival targets"}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4 py-2">
          {/* VOD Preview & Trimming (Clip / Segment) Section */}
          <div class="rounded-xl border border-border/70 bg-card/50 p-3 space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="i-mdi-movie-open text-primary size-4" />
                <span class="text-xs font-semibold text-foreground">
                  VOD Preview & Trimming
                </span>
                <Show
                  when={isTrimmed()}
                  fallback={
                    <span class="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50">
                      Full Broadcast ({formatApproxDuration(rawVodDurationSecs())})
                    </span>
                  }
                >
                  <span class="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20 flex items-center gap-1">
                    <span class="i-mdi-content-cut size-3" />
                    Clip: {formatSecondsToTimestamp(effectiveDurationSecs())} ({formatApproxDuration(effectiveDurationSecs())})
                  </span>
                </Show>
              </div>

              <div class="flex items-center gap-2">
                <Show when={isTrimmed()}>
                  <button
                    type="button"
                    onClick={handleResetTrim}
                    class="text-[11px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                  >
                    Reset to Full VOD
                  </button>
                </Show>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview())}
                  class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted cursor-pointer transition-colors"
                  title={showPreview() ? "Collapse video player" : "Expand video player"}
                >
                  <span class={showPreview() ? "i-mdi-chevron-up size-4" : "i-mdi-chevron-down size-4"} />
                  <span class="text-[10px]">{showPreview() ? "Hide Video" : "Show Video"}</span>
                </button>
              </div>
            </div>

            {/* Video Player Box */}
            <Show when={showPreview()}>
              <div class="space-y-2">
                <div class="relative aspect-video w-full rounded-lg overflow-hidden bg-black border border-border/40 shadow-inner">
                  <div
                    ref={(el) => (embedContainerRef = el)}
                    id="twitch-embed-preview"
                    class="w-full h-full"
                  />
                  <Show when={useIframeFallback()}>
                    <iframe
                      src={`https://player.twitch.tv/?video=${props.vod?.id}&parent=${window.location.hostname || "localhost"}&parent=localhost&parent=tauri.localhost&autoplay=false${playerTargetTimeSecs() !== null ? `&time=${playerTargetTimeSecs()}s` : ""}`}
                      class="w-full h-full border-0 absolute inset-0"
                      allowfullscreen
                      scrolling="no"
                    />
                  </Show>
                </div>

                {/* Player Scrub & Quick Markers */}
                <div class="flex flex-wrap items-center justify-between gap-2 bg-muted/40 rounded-lg px-2.5 py-1.5 border border-border/50 text-xs">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-xs text-foreground font-semibold flex items-center gap-1">
                      <span class="i-mdi-play-circle-outline size-3.5 text-primary" />
                      {formatSecondsToTimestamp(playerCurrentTime(), rawVodDurationSecs() >= 3600)}
                    </span>
                    <span class="text-[10px] text-muted-foreground">
                      / {formatSecondsToTimestamp(rawVodDurationSecs(), rawVodDurationSecs() >= 3600)}
                    </span>
                  </div>

                  {/* Scrub offsets */}
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => jumpDelta(-60)}
                      title="Seek backward 1 minute"
                      class="px-1.5 py-0.5 rounded bg-background hover:bg-muted text-[10px] font-mono border border-border/50 cursor-pointer transition-colors"
                    >
                      -1m
                    </button>
                    <button
                      type="button"
                      onClick={() => jumpDelta(-10)}
                      title="Seek backward 10 seconds"
                      class="px-1.5 py-0.5 rounded bg-background hover:bg-muted text-[10px] font-mono border border-border/50 cursor-pointer transition-colors"
                    >
                      -10s
                    </button>
                    <button
                      type="button"
                      onClick={() => jumpDelta(10)}
                      title="Seek forward 10 seconds"
                      class="px-1.5 py-0.5 rounded bg-background hover:bg-muted text-[10px] font-mono border border-border/50 cursor-pointer transition-colors"
                    >
                      +10s
                    </button>
                    <button
                      type="button"
                      onClick={() => jumpDelta(60)}
                      title="Seek forward 1 minute"
                      class="px-1.5 py-0.5 rounded bg-background hover:bg-muted text-[10px] font-mono border border-border/50 cursor-pointer transition-colors"
                    >
                      +1m
                    </button>
                  </div>

                  {/* Marker buttons */}
                  <div class="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleSetStartFromPlayer}
                      class="px-2 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[10px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                      title="Set player time as Start"
                    >
                      <span class="i-mdi-ray-start-arrow size-3" />
                      Set as Start
                    </button>
                    <button
                      type="button"
                      onClick={handleSetStopFromPlayer}
                      class="px-2 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 text-[10px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                      title="Set player time as Stop"
                    >
                      <span class="i-mdi-ray-end-arrow size-3" />
                      Set as Stop
                    </button>
                  </div>
                </div>

                {/* Timeline Range Slider */}
                <div class="space-y-1">
                  <input
                    type="range"
                    min="0"
                    max={rawVodDurationSecs() || 100}
                    value={playerCurrentTime()}
                    onInput={(e) => seekPlayer(Number(e.currentTarget.value))}
                    class="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    title="Scrub timeline"
                  />
                </div>
              </div>
            </Show>

            {/* Start & Stop Inputs */}
            <div class="grid grid-cols-2 gap-3 pt-1">
              {/* Start Timestamp Box */}
              <div class="space-y-1.5 p-2.5 rounded-lg border border-border/60 bg-background/60">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-semibold text-foreground flex items-center gap-1">
                    <span class="i-mdi-ray-start-arrow text-emerald-500 size-3.5" />
                    Start at (xy)
                  </label>
                  <Show when={parsedStartSecs() !== null}>
                    <span class="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                      {formatSecondsToTimestamp(parsedStartSecs())}
                    </span>
                  </Show>
                </div>

                <div class="flex items-center gap-1.5">
                  <Input
                    placeholder="e.g. 15 or 15:30"
                    value={startInput()}
                    onInput={(e) => setStartInput(e.currentTarget.value)}
                    class="h-8 text-xs font-mono"
                  />
                  <Show when={startInput()}>
                    <button
                      type="button"
                      onClick={() => setStartInput("")}
                      class="size-8 shrink-0 flex items-center justify-center rounded border border-border/50 text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Clear start time"
                    >
                      <span class="i-mdi-close size-3.5" />
                    </button>
                  </Show>
                </div>

                <div class="flex items-center justify-between text-[10px] pt-0.5">
                  <button
                    type="button"
                    onClick={handleSetStartFromPlayer}
                    class="text-primary hover:underline flex items-center gap-0.5 cursor-pointer font-medium"
                  >
                    <span class="i-mdi-map-marker-outline size-3" />
                    Use preview time
                  </button>
                  <Show when={parsedStartSecs() !== null}>
                    <button
                      type="button"
                      onClick={handlePreviewStart}
                      class="text-muted-foreground hover:text-foreground flex items-center gap-0.5 cursor-pointer"
                    >
                      <span class="i-mdi-play-circle-outline size-3" />
                      Preview start
                    </button>
                  </Show>
                </div>
              </div>

              {/* Stop Timestamp Box */}
              <div class="space-y-1.5 p-2.5 rounded-lg border border-border/60 bg-background/60">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-semibold text-foreground flex items-center gap-1">
                    <span class="i-mdi-ray-end-arrow text-rose-500 size-3.5" />
                    Stop at (xy)
                  </label>
                  <Show when={parsedEndSecs() !== null}>
                    <span class="text-[10px] font-mono text-rose-600 dark:text-rose-400 font-semibold">
                      {formatSecondsToTimestamp(parsedEndSecs())}
                    </span>
                  </Show>
                </div>

                <div class="flex items-center gap-1.5">
                  <Input
                    placeholder="e.g. 45 or 01:45:00"
                    value={stopInput()}
                    onInput={(e) => setStopInput(e.currentTarget.value)}
                    class="h-8 text-xs font-mono"
                  />
                  <Show when={stopInput()}>
                    <button
                      type="button"
                      onClick={() => setStopInput("")}
                      class="size-8 shrink-0 flex items-center justify-center rounded border border-border/50 text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Clear stop time"
                    >
                      <span class="i-mdi-close size-3.5" />
                    </button>
                  </Show>
                </div>

                <div class="flex items-center justify-between text-[10px] pt-0.5">
                  <button
                    type="button"
                    onClick={handleSetStopFromPlayer}
                    class="text-primary hover:underline flex items-center gap-0.5 cursor-pointer font-medium"
                  >
                    <span class="i-mdi-map-marker-outline size-3" />
                    Use preview time
                  </button>
                  <Show when={parsedEndSecs() !== null}>
                    <button
                      type="button"
                      onClick={handlePreviewStop}
                      class="text-muted-foreground hover:text-foreground flex items-center gap-0.5 cursor-pointer"
                    >
                      <span class="i-mdi-play-circle-outline size-3" />
                      Preview stop
                    </button>
                  </Show>
                </div>
              </div>
            </div>

            {/* Validation Error Alert */}
            <Show when={trimError()}>
              <div class="p-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-[11px] flex items-center gap-1.5">
                <span class="i-mdi-alert-circle-outline size-4 shrink-0" />
                <span>{trimError()}</span>
              </div>
            </Show>

            {/* Trimming Feedback Summary */}
            <Show when={isTrimmed() && !trimError()}>
              <div class="p-2 rounded-lg bg-primary/5 border border-primary/20 text-[11px] flex items-center justify-between text-muted-foreground">
                <span class="flex items-center gap-1.5">
                  <span class="i-mdi-information-outline size-3.5 text-primary" />
                  Archiving segment: <strong class="text-foreground">{formatSecondsToTimestamp(parsedStartSecs() ?? 0)}</strong> to <strong class="text-foreground">{formatSecondsToTimestamp(parsedEndSecs() ?? rawVodDurationSecs())}</strong> ({formatApproxDuration(effectiveDurationSecs())}).
                </span>
                <span class="font-medium text-emerald-600 dark:text-emerald-400">
                  ⚡ Saves ~{Math.round((1 - effectiveDurationSecs() / Math.max(rawVodDurationSecs(), 1)) * 100)}% download & encoding time
                </span>
              </div>
            </Show>
          </div>

          {/* Target Engine Selection */}
          <Show when={props.hasWorkerConfigured}>
            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-foreground">Execution Location</label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTarget("local")}
                  class={`p-2.5 rounded-lg border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                    target() === "local"
                      ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                      : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                  }`}
                >
                  <span class="i-mdi-laptop size-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <div class="font-semibold text-xs text-foreground">🖥️ Local PC</div>
                    <div class="text-[10px] text-muted-foreground leading-tight">
                      Uses local CPU/GPU & disk. App must stay open.
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setTarget("worker")}
                  class={`p-2.5 rounded-lg border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                    target() === "worker"
                      ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                      : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                  }`}
                >
                  <span class="i-mdi-cloud-outline size-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <div class="font-semibold text-xs text-foreground">☁️ Cloud VPS Worker</div>
                    <div class="text-[10px] text-muted-foreground leading-tight">
                      Runs 24/7 on your VPS. Works even if you close the app!
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </Show>

          {/* Quality Selection */}
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-foreground flex items-center justify-between">
              <span>Stream Quality</span>
              <Show when={loadingQualities()}>
                <span class="text-muted-foreground text-[11px] flex items-center gap-1">
                  <span class="i-mdi-loading animate-spin size-3" /> Fetching qualities...
                </span>
              </Show>
            </label>
            <Show
              when={!loadingQualities()}
              fallback={
                <div class="h-9 w-full rounded-md border border-input bg-muted/40 animate-pulse" />
              }
            >
              <select
                class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedQualityUrl()}
                onChange={(e) => setSelectedQualityUrl(e.currentTarget.value)}
              >
                <For each={qualities()}>
                  {(q) => (
                    <option value={q.url}>
                      {q.name}{" "}
                      {q.resolution ? `(${q.resolution}${q.fps ? ` @ ${q.fps}fps` : ""})` : ""}
                    </option>
                  )}
                </For>
              </select>
            </Show>
            <Show when={errorMsg()}>
              <p class="text-xs text-destructive">{errorMsg()}</p>
            </Show>
          </div>

          {/* Compression Preset & CRF */}
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-foreground">Encoder Preset</label>
              <select
                class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={preset()}
                onChange={(e) => setPreset(e.currentTarget.value)}
              >
                {/* Dynamically prioritize hardware encoders detected on target */}
                <Show when={activeHardwareHasNvenc()}>
                  <option value="hevc_nvenc">GPU NVENC (NVIDIA HEVC / H.265)</option>
                </Show>
                <Show when={activeHardwareHasAmf()}>
                  <option value="hevc_amf">GPU AMF (AMD HEVC / H.265)</option>
                </Show>
                <Show when={activeHardwareHasQsv()}>
                  <option value="hevc_qsv">GPU QuickSync (Intel HEVC / H.265)</option>
                </Show>
                <Show when={!activeHardwareHasNvenc() && !activeHardwareHasAmf() && !activeHardwareHasQsv()}>
                  <option value="hevc_nvenc">GPU NVENC (HEVC / H.265)</option>
                </Show>
                <Show when={!activeHardwareHasNvenc() && (activeHardwareHasAmf() || activeHardwareHasQsv())}>
                  <option value="hevc_nvenc">GPU NVENC (NVIDIA HEVC / H.265)</option>
                </Show>
                <Show when={!activeHardwareHasAmf() && (activeHardwareHasNvenc() || activeHardwareHasQsv())}>
                  <option value="hevc_amf">GPU AMF (AMD HEVC / H.265)</option>
                </Show>
                <Show when={!activeHardwareHasQsv() && (activeHardwareHasNvenc() || activeHardwareHasAmf())}>
                  <option value="hevc_qsv">GPU QuickSync (Intel HEVC / H.265)</option>
                </Show>
                <option value="libx265">CPU x265 (High Efficiency)</option>
                <option value="libx264">CPU x264 (Fast Compatibility)</option>
                <option value="passthrough">Passthrough (No re-encode)</option>
              </select>
            </div>

            <div class="space-y-1.5">
              <div class="flex items-center justify-between text-xs">
                <span class="font-semibold text-foreground">CRF ({crf()})</span>
                <span class="text-[10px] text-muted-foreground">Standard: 24</span>
              </div>
              <input
                type="range"
                min="18"
                max="32"
                value={crf()}
                onInput={(e) => setCrf(Number(e.currentTarget.value))}
                disabled={preset() === "passthrough"}
                class="w-full h-1.5 mt-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary disabled:opacity-40"
              />
            </div>
          </div>

          {/* Estimated Processing Duration */}
          <Show when={props.vod?.duration && durationSecs() > 0}>
            <div class="rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-2.5">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5">
                  <span class="i-mdi-timer-outline text-primary size-4" />
                  <span class="text-xs font-semibold text-foreground">Estimated Duration</span>
                  <Show when={estimation().isCalibrated}>
                    <span
                      class="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20"
                      title="Calibrated against real encoding benchmark metrics on your hardware"
                    >
                      🎯 Calibrated
                    </span>
                  </Show>
                </div>
                <div class="text-right">
                  <span class="text-xs font-bold text-primary">
                    Total {formatApproxDuration(estimation().totalSecs)}
                  </span>
                  <Show when={preset() !== "passthrough"}>
                    <div class="text-[10px] text-muted-foreground">
                      ~{estimation().speedMultiplier}x speed ({estimation().effectiveFps} fps)
                    </div>
                  </Show>
                </div>
              </div>

              {/* Hardware Fallback Warning Alert */}
              <Show when={estimation().isHardwareFallback}>
                <div class="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[11px] flex items-start gap-1.5 leading-tight">
                  <span class="i-mdi-alert-outline size-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <span class="font-semibold">Hardware Notice:</span> {estimation().fallbackReason}
                  </div>
                </div>
              </Show>

              {/* Breakdown Grid */}
              <div class={`grid ${estimation().uploadSecs > 0 ? "grid-cols-3" : "grid-cols-2"} gap-2 text-[11px]`}>
                <div class="p-2 rounded-lg bg-background/70 border border-border/50 space-y-0.5">
                  <div class="text-muted-foreground flex items-center gap-1 text-[10px]">
                    <span class="i-mdi-download size-3 text-blue-500" />
                    Download:
                  </div>
                  <div class="font-mono font-semibold text-foreground text-xs">
                    {formatApproxDuration(estimation().downloadSecs)}
                  </div>
                  <div class="text-[10px] text-muted-foreground truncate">
                    ~{estimation().downloadSizeMB} MB
                  </div>
                </div>

                <div class="p-2 rounded-lg bg-background/70 border border-border/50 space-y-0.5">
                  <div class="text-muted-foreground flex items-center gap-1 text-[10px]">
                    <span class="i-mdi-movie-filter size-3 text-amber-500" />
                    Compression:
                  </div>
                  <div class="font-mono font-semibold text-foreground text-xs">
                    {formatApproxDuration(estimation().compressionSecs)}
                  </div>
                  <div class="text-[10px] text-muted-foreground truncate">
                    ~{estimation().estimatedOutputSizeMB} MB output
                  </div>
                </div>

                <Show when={estimation().uploadSecs > 0}>
                  <div class="p-2 rounded-lg bg-background/70 border border-border/50 space-y-0.5">
                    <div class="text-muted-foreground flex items-center gap-1 text-[10px]">
                      <span class="i-mdi-cloud-upload size-3 text-purple-500" />
                      Cloud Upload:
                    </div>
                    <div class="font-mono font-semibold text-foreground text-xs">
                      {formatApproxDuration(estimation().uploadSecs)}
                    </div>
                    <div class="text-[10px] text-muted-foreground truncate">
                      Cloud destinations
                    </div>
                  </div>
                </Show>
              </div>

              {/* Hardware & Stream Profile Details */}
              <div class="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                <span class="truncate max-w-[65%]">
                  Host: <strong class="text-foreground font-medium">{estimation().hardwareDescription}</strong>
                </span>
                <span class="shrink-0 font-mono text-[10px]">
                  {parsedQuality().rawResolution}
                </span>
              </div>
            </div>
          </Show>

          {/* Configurable Destinations */}
          <div class="space-y-2 pt-2 border-t border-border/50">
            <label class="text-xs font-semibold text-foreground">
              Archival Destinations & Actions
            </label>

            {/* S3 Storage */}
            <Show when={props.hasS3Configured}>
              <label class="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={uploadToS3()}
                  onChange={(e) => setUploadToS3(e.currentTarget.checked)}
                  class="rounded border-input text-primary focus:ring-primary size-4"
                />
                <span class="flex items-center gap-1.5">
                  <span class="i-mdi-cloud-upload text-primary size-4" />
                  Upload to Cloud Storage (S3 / Cloudflare R2 / Backblaze B2)
                </span>
              </label>
            </Show>

            {/* Google Drive Storage */}
            <Show when={props.hasGdriveConfigured}>
              <label class="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={uploadToGdrive()}
                  onChange={(e) => setUploadToGdrive(e.currentTarget.checked)}
                  class="rounded border-input text-primary focus:ring-primary size-4"
                />
                <span class="flex items-center gap-1.5">
                  <span class="i-mdi-google-drive text-amber-500 size-4" />
                  Upload to Google Drive
                </span>
              </label>
            </Show>

            {/* WebDAV / Nextcloud / NAS */}
            <Show when={props.hasWebdavConfigured}>
              <label class="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={uploadToWebdav()}
                  onChange={(e) => setUploadToWebdav(e.currentTarget.checked)}
                  class="rounded border-input text-primary focus:ring-primary size-4"
                />
                <span class="flex items-center gap-1.5">
                  <span class="i-mdi-folder-network text-blue-500 size-4" />
                  Upload to WebDAV / Nextcloud / NAS
                </span>
              </label>
            </Show>

            {/* Keep Local Download */}
            <label class="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={saveLocal()}
                onChange={(e) => setSaveLocal(e.currentTarget.checked)}
                class="rounded border-input text-primary focus:ring-primary size-4"
              />
              <span class="flex items-center gap-1.5">
                <span class="i-mdi-download text-primary size-4" />
                Save / Keep Local Copy (in output directory)
              </span>
            </label>

            {/* YouTube Publish */}
            <Show when={props.hasYouTubeConfigured}>
              <div class="space-y-2">
                <label class="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={uploadToYouTube()}
                    onChange={(e) => setUploadToYouTube(e.currentTarget.checked)}
                    class="rounded border-input text-primary focus:ring-primary size-4"
                  />
                  <span class="flex items-center gap-1.5">
                    <span class="i-mdi-youtube text-red-500 size-4" />
                    Publish directly to YouTube
                  </span>
                </label>

                <Show when={uploadToYouTube()}>
                  <div class="ml-6 p-2.5 rounded-lg border bg-muted/30 space-y-2">
                    <div class="space-y-1">
                      <label class="text-[11px] font-semibold text-foreground">
                        YouTube Video Title
                      </label>
                      <Input
                        value={ytTitle()}
                        onInput={(e) => setYtTitle(e.currentTarget.value)}
                        class="h-8 text-xs"
                        placeholder="Video Title"
                      />
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                      <div class="space-y-1">
                        <label class="text-[11px] font-semibold text-foreground">
                          Privacy Status
                        </label>
                        <select
                          class="flex h-8 w-full rounded-md border border-input bg-background px-2 py-0.5 text-xs shadow-sm"
                          value={ytPrivacy()}
                          onChange={(e) =>
                            setYtPrivacy(e.currentTarget.value as "private" | "unlisted" | "public")
                          }
                        >
                          <option value="unlisted">Unlisted</option>
                          <option value="private">Private</option>
                          <option value="public">Public</option>
                        </select>
                      </div>

                      <div class="space-y-1">
                        <label class="text-[11px] font-semibold text-foreground">
                          Tags (comma-separated)
                        </label>
                        <Input
                          value={ytTags()}
                          onInput={(e) => setYtTags(e.currentTarget.value)}
                          class="h-8 text-xs"
                          placeholder="tag1, tag2"
                        />
                      </div>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Delete from Twitch */}
            <Show when={isOwnVod()}>
              <div class="pt-1">
                <label class="flex items-center gap-2 text-xs font-medium select-none text-destructive cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteFromTwitch()}
                    onChange={(e) => setDeleteFromTwitch(e.currentTarget.checked)}
                    class="rounded border-destructive text-destructive focus:ring-destructive size-4"
                  />
                  <span class="flex items-center gap-1.5">
                    <span class="i-mdi-delete-clock size-4" />
                    Delete from Twitch once successfully archived
                  </span>
                </label>
                <p class="text-[10px] text-muted-foreground ml-6 pt-0.5">
                  Automatically frees up channel VOD space on Twitch after all selected uploads
                  succeed.
                </p>
              </div>
            </Show>

            {/* Notice if no cloud destinations are configured */}
            <Show when={!hasAnyCloudConfigured()}>
              <div class="rounded-lg border border-dashed border-border/80 p-3 bg-muted/20 text-xs text-muted-foreground flex items-start gap-2">
                <span class="i-mdi-information-outline size-4 text-primary shrink-0 mt-0.5" />
                <span>
                  No cloud destinations configured. You can configure S3, Google Drive, WebDAV, or YouTube in Settings.
                </span>
              </div>
            </Show>

            {/* Validation warning if no action selected */}
            <Show when={!hasSelectedDestination()}>
              <p class="text-[11px] text-amber-500 font-medium pt-1">
                Please select at least one archive destination or action (e.g. Save Local Copy).
              </p>
            </Show>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleStart}
            disabled={
              !selectedQualityUrl() ||
              loadingQualities() ||
              !hasSelectedDestination() ||
              Boolean(trimError())
            }
            class="gap-1.5"
          >
            <span class="i-mdi-play size-4" aria-hidden="true" />
            {isTrimmed()
              ? props.hasWorkerConfigured && target() === "worker"
                ? "Offload Clip to VPS Worker"
                : "Archive Clip Locally"
              : props.hasWorkerConfigured && target() === "worker"
                ? "Offload to VPS Worker"
                : "Start Archiving Locally"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
