import type { Component } from "solid-js";
import { Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { formatBytes, formatEta, formatSpeed } from "~/lib/utils";
import type {
  CompressionProgress,
  DownloadProgress,
  DriveTransferProgress,
  S3TransferProgress,
} from "~/types";

export type PipelineStage = "idle" | "downloading" | "compressing" | "uploading" | "completed";

export interface PipelineMonitorProps {
  stage: PipelineStage;
  activeVodId: string | null;
  downloadProgress: DownloadProgress | null;
  compressionProgress: CompressionProgress | null;
  s3Progress: S3TransferProgress | null;
  driveProgress?: DriveTransferProgress | null;
  onCancel: () => void;
}

export const PipelineMonitor: Component<PipelineMonitorProps> = (props) => {
  return (
    <Card class="border bg-card/70 backdrop-blur-sm shadow-md">
      <CardHeader class="pb-3 flex flex-row items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="relative flex size-2.5">
            <Show
              when={props.stage !== "idle" && props.stage !== "completed"}
              fallback={<span class="size-2.5 rounded-full bg-muted-foreground/40" />}
            >
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span class="relative inline-flex rounded-full size-2.5 bg-primary" />
            </Show>
          </div>
          <CardTitle class="text-sm">Processing Pipeline</CardTitle>
          <Show when={props.activeVodId}>
            <span class="text-xs font-mono text-muted-foreground">VOD #{props.activeVodId}</span>
          </Show>
        </div>

        <div class="flex items-center gap-2">
          <Badge
            variant={
              props.stage === "completed"
                ? "success"
                : props.stage === "idle"
                ? "secondary"
                : "default"
            }
            class="capitalize text-xs font-medium"
          >
            {props.stage}
          </Badge>
          <Show when={props.stage !== "idle" && props.stage !== "completed"}>
            <Button
              variant="destructive"
              size="sm"
              onClick={props.onCancel}
              class="h-7 text-xs px-2.5 gap-1"
            >
              <span class="i-mdi-stop size-3.5" aria-hidden="true" />
              Cancel
            </Button>
          </Show>
        </div>
      </CardHeader>

      <CardContent class="space-y-4 pt-1">
        {/* Stage 1: Download HLS Chunks */}
        <div class="space-y-1.5">
          <div class="flex items-center justify-between text-xs">
            <span class="flex items-center gap-1.5 font-medium text-foreground">
              <span
                class={
                  props.stage === "downloading"
                    ? "i-mdi-download size-4 text-primary animate-bounce"
                    : props.stage === "compressing" || props.stage === "uploading" || props.stage === "completed"
                    ? "i-mdi-check-circle size-4 text-emerald-500"
                    : "i-mdi-circle-outline size-4 text-muted-foreground"
                }
              />
              1. Download Stream Segments
            </span>
            <Show when={props.stage === "downloading" ? props.downloadProgress : null}>
              {(dl) => (
                <span class="font-mono text-muted-foreground">
                  {dl().downloaded_chunks} / {dl().total_chunks} ({dl().percent.toFixed(1)}%) •{" "}
                  {formatSpeed(dl().speed_mbps)} • ETA: {formatEta(dl().eta_seconds)}
                </span>
              )}
            </Show>
          </div>
          <Progress
            value={
              props.stage === "downloading"
                ? props.downloadProgress?.percent || 0
                : props.stage === "compressing" || props.stage === "uploading" || props.stage === "completed"
                ? 100
                : 0
            }
          />
        </div>

        {/* Stage 2: Hardware-Accelerated Video Compression */}
        <div class="space-y-1.5">
          <div class="flex items-center justify-between text-xs">
            <span class="flex items-center gap-1.5 font-medium text-foreground">
              <span
                class={
                  props.stage === "compressing"
                    ? "i-mdi-movie-filter size-4 text-primary animate-spin"
                    : props.stage === "uploading" || props.stage === "completed"
                    ? "i-mdi-check-circle size-4 text-emerald-500"
                    : "i-mdi-circle-outline size-4 text-muted-foreground"
                }
              />
              2. Video Compression & Optimization (FFmpeg)
            </span>
            <Show when={props.stage === "compressing" ? props.compressionProgress : null}>
              {(cp) => (
                <span class="font-mono text-muted-foreground">
                  {cp().percent.toFixed(1)}% • {cp().fps.toFixed(0)} FPS • {cp().speed} • Output:{" "}
                  {formatBytes(cp().size_bytes)}
                </span>
              )}
            </Show>
          </div>
          <Progress
            value={
              props.stage === "compressing"
                ? props.compressionProgress?.percent || 0
                : props.stage === "uploading" || props.stage === "completed"
                ? 100
                : 0
            }
          />
        </div>

        {/* Stage 3: S3 Cloud Upload */}
        <div class="space-y-1.5">
          <div class="flex items-center justify-between text-xs">
            <span class="flex items-center gap-1.5 font-medium text-foreground">
              <span
                class={
                  props.stage === "uploading"
                    ? "i-mdi-cloud-upload size-4 text-primary animate-pulse"
                    : props.stage === "completed"
                    ? "i-mdi-check-circle size-4 text-emerald-500"
                    : "i-mdi-circle-outline size-4 text-muted-foreground"
                }
              />
              3. Cloud Archival (S3 / Google Drive / WebDAV)
            </span>
            <Show when={props.stage === "uploading" ? (props.s3Progress || props.driveProgress) : null}>
              {(prog) => {
                const p = prog();
                return (
                  <span class="font-mono text-muted-foreground">
                    {formatBytes(p.bytes_transferred)} / {formatBytes(p.total_bytes)} (
                    {p.percent.toFixed(1)}%) • {formatSpeed(p.speed_mbps)}
                  </span>
                );
              }}
            </Show>
          </div>
          <Progress
            value={
              props.stage === "uploading"
                ? (props.s3Progress?.percent ?? props.driveProgress?.percent ?? 0)
                : props.stage === "completed"
                ? 100
                : 0
            }
          />
        </div>
      </CardContent>
    </Card>
  );
};
