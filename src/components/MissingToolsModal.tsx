import { type Component, Show, createSignal, onMount, onCleanup } from "solid-js";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "solid-sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Progress } from "~/components/ui/progress";
import {
  detectFfmpeg,
  downloadAndInstallFfmpeg,
  onToolDownloadProgress,
  saveSettings,
} from "~/services/tauri";
import type { AppSettings, FfmpegInfo, ToolDownloadProgress } from "~/types";

export interface MissingToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings | null;
  onToolInstalled: (info: FfmpegInfo, updatedSettings?: AppSettings) => void;
}

export const MissingToolsModal: Component<MissingToolsModalProps> = (props) => {
  const [downloading, setDownloading] = createSignal(false);
  const [progress, setProgress] = createSignal<ToolDownloadProgress | null>(null);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);

  onMount(() => {
    let unlisten: (() => void) | undefined;
    onToolDownloadProgress((p) => {
      setProgress(p);
      if (p.stage === "error") {
        setErrorMsg(p.message);
        setDownloading(false);
      }
    }).then((un) => (unlisten = un));

    onCleanup(() => {
      if (unlisten) unlisten();
    });
  });

  const handleStartDownload = async () => {
    setDownloading(true);
    setErrorMsg(null);
    setProgress({
      tool: "ffmpeg",
      stage: "downloading",
      percent: 0,
      downloaded_bytes: 0,
      total_bytes: 0,
      message: "Initiating FFmpeg download...",
    });

    const result = await downloadAndInstallFfmpeg();
    result.match(
      (info) => {
        setDownloading(false);
        toast.success("FFmpeg successfully installed!");
        props.onToolInstalled(info);
        props.onClose();
      },
      (err) => {
        setDownloading(false);
        setErrorMsg(`Installation failed: ${err.message}`);
        toast.error(`FFmpeg download failed: ${err.message}`);
      },
    );
  };

  const handleBrowseExisting = async () => {
    try {
      const selected = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "FFmpeg Executable",
            extensions: ["exe", "*"],
          },
        ],
      });

      if (selected && typeof selected === "string") {
        if (props.settings) {
          const updated: AppSettings = {
            ...props.settings,
            ffmpeg_path: selected,
          };
          const saveRes = await saveSettings(updated);
          saveRes.match(
            async () => {
              const detectRes = await detectFfmpeg();
              detectRes.match(
                (info) => {
                  props.onToolInstalled(info, updated);
                  toast.success(`FFmpeg path set: ${info.version || selected}`);
                  props.onClose();
                },
                (err) => {
                  toast.error(`Invalid FFmpeg binary: ${err.message}`);
                },
              );
            },
            (err) => toast.error(`Failed to save settings: ${err.message}`),
          );
        }
      }
    } catch (e) {
      toast.error(`File selection failed: ${String(e)}`);
    }
  };

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => !downloading() && !open && props.onClose()}>
      <DialogContent class="sm:max-w-lg bg-card/95 backdrop-blur-xl border-border/80 shadow-2xl">
        <DialogHeader class="space-y-2">
          <div class="flex items-center gap-3">
            <div class="flex size-10 items-center justify-center rounded-xl bg-primary/20 text-primary">
              <span class="iconify mdi--movie-cog size-6" />
            </div>
            <div>
              <DialogTitle class="text-base font-bold font-heading">
                FFmpeg Setup & Tool Manager
              </DialogTitle>
              <DialogDescription class="text-xs text-muted-foreground">
                Automated detection, installation, and configuration of video processing tools.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <div class="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
            <div class="flex items-start gap-3">
              <span class="iconify mdi--information-outline size-5 text-primary shrink-0 mt-0.5" />
              <div class="space-y-1 text-xs leading-relaxed text-muted-foreground">
                <p class="font-medium text-foreground">Why does Twitch VOD Manager need FFmpeg?</p>
                <p>
                  Twitch broadcasts are streamed as thousands of individual video chunks. FFmpeg
                  losslessly concatenates these chunks into a complete MP4 file and enables
                  high-efficiency hardware-accelerated video compression (NVENC, QSV, AMF) to save
                  70%+ disk space.
                </p>
              </div>
            </div>

            <Show when={errorMsg()}>
              <div class="rounded-lg bg-destructive/10 border border-destructive/30 p-2.5 text-xs text-destructive flex items-center gap-2">
                <span class="iconify mdi--alert-circle size-4 shrink-0" />
                <span>{errorMsg()}</span>
              </div>
            </Show>
          </div>

          {/* Download progress section */}
          <Show when={downloading() || progress()}>
            <div class="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3 animate-in fade-in duration-300">
              <div class="flex items-center justify-between text-xs">
                <span class="font-bold text-foreground flex items-center gap-2">
                  <span class="iconify mdi--loading animate-spin size-4 text-primary" />
                  {progress()?.message || "Processing..."}
                </span>
                <span class="font-mono text-primary font-bold">
                  {Math.round(progress()?.percent || 0)}%
                </span>
              </div>
              <Progress value={progress()?.percent || 0} class="h-2" />
              <div class="flex justify-between text-[11px] text-muted-foreground font-mono">
                <span>Stage: {progress()?.stage || "downloading"}</span>
                <span>
                  {progress()?.downloaded_bytes
                    ? `${(progress()!.downloaded_bytes / 1048576).toFixed(1)} MB`
                    : ""}
                </span>
              </div>
            </div>
          </Show>
        </div>

        <DialogFooter class="flex flex-col sm:flex-row items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBrowseExisting}
            disabled={downloading()}
            class="w-full sm:w-auto text-xs h-9"
          >
            <span class="iconify mdi--folder-open mr-1.5 size-4" />
            Select Local FFmpeg...
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={handleStartDownload}
            disabled={downloading()}
            class="w-full sm:w-auto text-xs h-9 font-bold shadow-sm"
          >
            <span class="iconify mdi--download mr-1.5 size-4" />
            {downloading() ? "Installing FFmpeg..." : "Download & Install (One-Click)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
