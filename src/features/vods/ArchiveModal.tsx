import type { Component } from "solid-js";
import { createEffect, createSignal, For, Show } from "solid-js";
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
import { getQualities } from "~/services/tauri";
import type { TwitchVod, VodQuality, YouTubeVideoMetadata } from "~/types";

export interface ArchiveModalConfirmConfig {
  target: "local" | "worker";
  vodId: string;
  title: string;
  playlistUrl: string;
  preset: string;
  crf: number;
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
}

export const ArchiveModal: Component<ArchiveModalProps> = (props) => {
  const [target, setTarget] = createSignal<"local" | "worker">("local");
  const [qualities, setQualities] = createSignal<VodQuality[]>([]);
  const [selectedQualityUrl, setSelectedQualityUrl] = createSignal("");
  const [preset, setPreset] = createSignal(props.defaultPreset || "hevc_nvenc");
  const [crf, setCrf] = createSignal(props.defaultCrf || 24);

  // Configurable Destinations
  const [uploadToS3, setUploadToS3] = createSignal(true);
  const [uploadToGdrive, setUploadToGdrive] = createSignal(false);
  const [uploadToWebdav, setUploadToWebdav] = createSignal(false);
  const [saveLocal, setSaveLocal] = createSignal(true);
  const [uploadToYouTube, setUploadToYouTube] = createSignal(false);
  const [deleteFromTwitch, setDeleteFromTwitch] = createSignal(false);

  // YouTube Metadata
  const [ytTitle, setYtTitle] = createSignal("");
  const [ytPrivacy, setYtPrivacy] = createSignal<"private" | "unlisted" | "public">("unlisted");
  const [ytTags, setYtTags] = createSignal("Twitch, VOD, Stream");

  const [loadingQualities, setLoadingQualities] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal("");

  createEffect(() => {
    const v = props.vod;
    if (props.isOpen && v) {
      setLoadingQualities(true);
      setErrorMsg("");
      setYtTitle(`[VOD] ${v.title}`);

      // Default to worker if configured and preferred
      if (props.hasWorkerConfigured) {
        setTarget("worker");
      } else {
        setTarget("local");
      }

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
        }
      );
    }
  });

  const handleStart = () => {
    if (!props.vod || !selectedQualityUrl()) return;

    const ytMeta: YouTubeVideoMetadata | undefined = uploadToYouTube()
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
      target: target(),
      vodId: props.vod.id,
      title: props.vod.title,
      playlistUrl: selectedQualityUrl(),
      preset: preset(),
      crf: crf(),
      saveLocal: saveLocal(),
      uploadToS3: uploadToS3(),
      uploadToGdrive: uploadToGdrive(),
      uploadToWebdav: uploadToWebdav(),
      uploadToYouTube: uploadToYouTube(),
      youtubeMetadata: ytMeta,
      deleteFromTwitchAfter: deleteFromTwitch(),
    });
    props.onClose();
  };

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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
          {/* Target Engine Selection */}
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
                      {q.name} {q.resolution ? `(${q.resolution}${q.fps ? ` @ ${q.fps}fps` : ""})` : ""}
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
                <option value="hevc_nvenc">GPU NVENC (HEVC / H.265)</option>
                <option value="libx265">CPU x265 (High Efficiency)</option>
                <option value="libx264">CPU x264 (Compatibility)</option>
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

          {/* Configurable Destinations */}
          <div class="space-y-2 pt-2 border-t border-border/50">
            <label class="text-xs font-semibold text-foreground">Archival Destinations & Actions</label>

            {/* S3 Storage */}
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

            {/* Google Drive Storage */}
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

            {/* WebDAV / Nextcloud / NAS */}
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
                    <label class="text-[11px] font-semibold text-foreground">YouTube Video Title</label>
                    <Input
                      value={ytTitle()}
                      onInput={(e) => setYtTitle(e.currentTarget.value)}
                      class="h-8 text-xs"
                      placeholder="Video Title"
                    />
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <div class="space-y-1">
                      <label class="text-[11px] font-semibold text-foreground">Privacy Status</label>
                      <select
                        class="flex h-8 w-full rounded-md border border-input bg-background px-2 py-0.5 text-xs shadow-sm"
                        value={ytPrivacy()}
                        onChange={(e) => setYtPrivacy(e.currentTarget.value as "private" | "unlisted" | "public")}
                      >
                        <option value="unlisted">Unlisted</option>
                        <option value="private">Private</option>
                        <option value="public">Public</option>
                      </select>
                    </div>

                    <div class="space-y-1">
                      <label class="text-[11px] font-semibold text-foreground">Tags (comma-separated)</label>
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

            {/* Delete from Twitch */}
            <div class="pt-1">
              <label class="flex items-center gap-2 text-xs font-medium text-destructive cursor-pointer select-none">
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
                Automatically frees up channel VOD space on Twitch after all selected uploads succeed.
              </p>
            </div>
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
            disabled={!selectedQualityUrl() || loadingQualities()}
            class="gap-1.5"
          >
            <span class="i-mdi-play size-4" aria-hidden="true" />
            {target() === "worker" ? "Offload to VPS Worker" : "Start Archiving Locally"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
