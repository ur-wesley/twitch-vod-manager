import type { Component } from "solid-js";
import { createEffect, createSignal, Show } from "solid-js";
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
import { Progress } from "~/components/ui/progress";
import { formatBytes, formatSpeed } from "~/lib/utils";
import {
  loginYouTube,
  onYouTubeUploadProgress,
  publishToYouTube,
} from "~/services/tauri";
import type { YouTubeUploadProgress } from "~/types";

export interface YouTubePublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  vodId: string;
  vodTitle: string;
  localVideoPath: string;
  isYouTubeConnected: boolean;
  onYouTubeConnected: () => void;
}

export const YouTubePublishModal: Component<YouTubePublishModalProps> = (props) => {
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [privacy, setPrivacy] = createSignal<"private" | "unlisted" | "public">("unlisted");
  const [tags, setTags] = createSignal("Twitch, VOD, Gaming, Stream");
  const [uploading, setUploading] = createSignal(false);
  const [progress, setProgress] = createSignal<YouTubeUploadProgress | null>(null);
  const [completedVideoId, setCompletedVideoId] = createSignal<string | null>(null);
  const [errorMsg, setErrorMsg] = createSignal("");
  const [connecting, setConnecting] = createSignal(false);

  createEffect(() => {
    if (props.isOpen) {
      setTitle(`[VOD] ${props.vodTitle}`);
      setDescription(`Stream broadcast archive.\nOriginally streamed on Twitch.\n\n#Twitch #VOD`);
      setUploading(false);
      setConnecting(false);
      setProgress(null);
      setCompletedVideoId(null);
      setErrorMsg("");
    }
  });

  createEffect(() => {
    let unlisten: (() => void) | undefined;
    onYouTubeUploadProgress((p) => {
      setProgress(p);
      if (p.video_id) {
        setCompletedVideoId(p.video_id);
        setUploading(false);
      }
    }).then((un) => {
      unlisten = un;
    });

    return () => unlisten?.();
  });

  const handleConnect = async () => {
    setConnecting(true);
    setErrorMsg("");
    const res = await loginYouTube();
    setConnecting(false);
    res.match(
      () => props.onYouTubeConnected(),
      (err) => setErrorMsg(err.message)
    );
  };

  const handleUpload = () => {
    if (!props.localVideoPath) {
      setErrorMsg("Video file is not available locally. Download from bucket first.");
      return;
    }

    setUploading(true);
    setErrorMsg("");

    const tagList = tags()
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    publishToYouTube(props.vodId, props.localVideoPath, {
      title: title(),
      description: description(),
      privacy_status: privacy(),
      tags: tagList,
    }).match(
      (id) => {
        setCompletedVideoId(id);
        setUploading(false);
      },
      (err) => {
        setErrorMsg(err.message);
        setUploading(false);
      }
    );
  };

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => !open && !uploading() && props.onClose()}>
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <span class="i-mdi-youtube text-red-500 size-5" aria-hidden="true" />
            Publish VOD to YouTube
          </DialogTitle>
          <DialogDescription>
            Upload archived broadcast directly to your YouTube channel.
          </DialogDescription>
        </DialogHeader>

        <Show
          when={props.isYouTubeConnected}
          fallback={
            <div class="py-6 text-center space-y-3">
              <div class="mx-auto size-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                <span class="i-mdi-youtube size-6" />
              </div>
              <div class="space-y-1">
                <h4 class="font-medium text-sm">YouTube Account Not Connected</h4>
                <p class="text-xs text-muted-foreground max-w-xs mx-auto">
                  Connect your Google account with YouTube permissions to enable automatic uploads.
                </p>
              </div>
              <Button
                variant="default"
                size="sm"
                disabled={connecting()}
                onClick={handleConnect}
                class="bg-red-600 hover:bg-red-700 text-white gap-2 cursor-pointer"
              >
                <span class={`i-mdi-${connecting() ? "loading animate-spin" : "google"} size-4`} />
                {connecting() ? "Opening Browser..." : "Connect YouTube Account"}
              </Button>
              <Show when={errorMsg()}>
                <p class="text-xs text-destructive">{errorMsg()}</p>
              </Show>
            </div>
          }
        >
          <Show
            when={!completedVideoId()}
            fallback={
              <div class="py-6 text-center space-y-4">
                <div class="mx-auto size-12 rounded-full bg-emerald-500/15 flex items-center justify-center text-emerald-500">
                  <span class="i-mdi-check size-6" />
                </div>
                <div class="space-y-1">
                  <h4 class="font-semibold text-base text-foreground">Upload Successful!</h4>
                  <p class="text-xs text-muted-foreground">
                    Your video is now being processed on YouTube.
                  </p>
                </div>
                <a
                  href={`https://youtu.be/${completedVideoId()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
                >
                  <span class="i-mdi-open-in-new size-3.5" />
                  View Video on YouTube (youtu.be/{completedVideoId()})
                </a>
              </div>
            }
          >
            <div class="space-y-3 py-1">
              <div class="space-y-1">
                <label class="text-xs font-semibold text-foreground">Video Title</label>
                <Input
                  value={title()}
                  onInput={(e) => setTitle(e.currentTarget.value)}
                  disabled={uploading()}
                  placeholder="Video Title"
                />
              </div>

              <div class="space-y-1">
                <label class="text-xs font-semibold text-foreground">Description</label>
                <textarea
                  class="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={description()}
                  onInput={(e) => setDescription(e.currentTarget.value)}
                  disabled={uploading()}
                />
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1">
                  <label class="text-xs font-semibold text-foreground">Privacy</label>
                  <select
                    class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={privacy()}
                    onChange={(e) => setPrivacy(e.currentTarget.value as "private" | "public" | "unlisted")}
                    disabled={uploading()}
                  >
                    <option value="unlisted">Unlisted (Archive)</option>
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                  </select>
                </div>

                <div class="space-y-1">
                  <label class="text-xs font-semibold text-foreground">Tags</label>
                  <Input
                    value={tags()}
                    onInput={(e) => setTags(e.currentTarget.value)}
                    disabled={uploading()}
                    placeholder="tag1, tag2"
                  />
                </div>
              </div>

              {/* Upload Progress Bar */}
              <Show when={uploading() && progress()}>
                {(p) => (
                  <div class="space-y-1.5 pt-2 border-t border-border/50">
                    <div class="flex justify-between text-xs font-mono text-muted-foreground">
                      <span>{p().percent.toFixed(1)}%</span>
                      <span>
                        {formatBytes(p().bytes_uploaded)} / {formatBytes(p().total_bytes)} (
                        {formatSpeed(p().speed_mbps || 0)})
                      </span>
                    </div>
                    <Progress value={p().percent} />
                  </div>
                )}
              </Show>

              <Show when={errorMsg()}>
                <p class="text-xs text-destructive">{errorMsg()}</p>
              </Show>
            </div>
          </Show>
        </Show>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={props.onClose} disabled={uploading()}>
            {completedVideoId() ? "Close" : "Cancel"}
          </Button>
          <Show when={props.isYouTubeConnected && !completedVideoId()}>
            <Button
              variant="default"
              size="sm"
              onClick={handleUpload}
              disabled={uploading() || !title()}
              class="gap-1.5 bg-red-600 hover:bg-red-700 text-white"
            >
              <span class="i-mdi-upload size-4" aria-hidden="true" />
              {uploading() ? "Uploading..." : "Publish to YouTube"}
            </Button>
          </Show>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
