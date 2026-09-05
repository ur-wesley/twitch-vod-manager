import type { Component } from "solid-js";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { toast } from "solid-sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  onWorkerDownloadProgress,
  workerCancelJob,
  workerDeleteJob,
  workerDownloadFile,
  workerGetJobLogs,
  workerGetStatus,
  workerListJobs,
  workerSyncSettings,
  workerTriggerWatcher,
} from "~/services/tauri";
import type { AppSettings, WorkerJob, WorkerJobLog, WorkerStatus } from "~/types";

export interface CloudWorkersViewProps {
  settings: AppSettings;
  onOpenSettings: () => void;
}

export const CloudWorkersView: Component<CloudWorkersViewProps> = (props) => {
  const [status, setStatus] = createSignal<WorkerStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = createSignal(false);
  const [isOnline, setIsOnline] = createSignal(false);
  const [pingLatency, setPingLatency] = createSignal<number | null>(null);

  const [jobs, setJobs] = createSignal<WorkerJob[]>([]);
  const [loadingJobs, setLoadingJobs] = createSignal(false);

  // Sync state
  const [syncing, setSyncing] = createSignal(false);
  const [checkingWatcher, setCheckingWatcher] = createSignal(false);

  // Log viewer modal
  const [selectedJobForLogs, setSelectedJobForLogs] = createSignal<WorkerJob | null>(null);
  const [logs, setLogs] = createSignal<WorkerJobLog[]>([]);
  const [loadingLogs, setLoadingLogs] = createSignal(false);

  // Deployment guide modal
  const [guideOpen, setGuideOpen] = createSignal(false);

  // Local downloading state
  const [downloadingJobId, setDownloadingJobId] = createSignal<string | null>(null);
  const [downloadPercent, setDownloadPercent] = createSignal(0);

  const workerUrl = () => props.settings.worker_url || "";
  const apiKey = () => props.settings.worker_api_key || "";

  const fetchStatus = () => {
    if (!workerUrl()) {
      setIsOnline(false);
      setStatus(null);
      return;
    }

    setLoadingStatus(true);
    const start = performance.now();

    workerGetStatus(workerUrl(), apiKey()).match(
      (s) => {
        setPingLatency(Math.round(performance.now() - start));
        setStatus(s);
        setIsOnline(true);
        setLoadingStatus(false);
      },
      () => {
        setIsOnline(false);
        setStatus(null);
        setLoadingStatus(false);
      }
    );
  };

  const fetchJobs = () => {
    if (!workerUrl() || !isOnline()) return;
    setLoadingJobs(true);

    workerListJobs(workerUrl(), apiKey()).match(
      (list) => {
        setJobs(list);
        setLoadingJobs(false);
      },
      (err) => {
        setLoadingJobs(false);
        toast.error(`Failed to fetch VPS jobs: ${err.message}`);
      }
    );
  };

  const refreshAll = () => {
    fetchStatus();
    fetchJobs();
  };

  onMount(() => {
    refreshAll();

    // Auto-refresh every 5 seconds while on this view
    const timer = setInterval(() => {
      if (workerUrl()) {
        fetchStatus();
        fetchJobs();
      }
    }, 5000);

    let unlistenDl: (() => void) | undefined;
    onWorkerDownloadProgress((p) => {
      setDownloadPercent(Math.round(p.percent));
      if (p.percent >= 100) {
        setDownloadingJobId(null);
        toast.success("Download from VPS completed!");
      }
    }).then((un) => (unlistenDl = un));

    onCleanup(() => {
      clearInterval(timer);
      unlistenDl?.();
    });
  });

  const handleSyncSettings = () => {
    if (!workerUrl()) {
      toast.error("Worker URL is not configured in Settings");
      return;
    }

    setSyncing(true);
    workerSyncSettings(workerUrl(), apiKey()).match(
      () => {
        setSyncing(false);
        toast.success("Settings synced to VPS Worker successfully!");
        fetchStatus();
      },
      (err) => {
        setSyncing(false);
        toast.error(`Sync failed: ${err.message}`);
      }
    );
  };

  const handleTriggerWatcher = () => {
    if (!workerUrl()) return;
    setCheckingWatcher(true);
    workerTriggerWatcher(workerUrl(), apiKey()).match(
      (res) => {
        setCheckingWatcher(false);
        if (res.success) {
          toast.success(res.message || `Check complete: ${res.queued_jobs} new stream(s) queued`);
          fetchJobs();
        } else {
          toast.error("Watcher check error");
        }
      },
      (err) => {
        setCheckingWatcher(false);
        toast.error(`Watcher trigger failed: ${err.message}`);
      }
    );
  };

  const handleCancelJob = (jobId: string) => {
    if (!confirm("Are you sure you want to cancel this VPS job?")) return;

    workerCancelJob(workerUrl(), apiKey(), jobId).match(
      () => {
        toast.info("Cancellation requested");
        fetchJobs();
      },
      (err) => toast.error(err.message)
    );
  };

  const handleDeleteJob = (jobId: string) => {
    if (!confirm("Delete this job record from the VPS?")) return;

    workerDeleteJob(workerUrl(), apiKey(), jobId).match(
      () => {
        toast.success("Job record removed");
        fetchJobs();
      },
      (err) => toast.error(err.message)
    );
  };

  const handleOpenLogs = (job: WorkerJob) => {
    setSelectedJobForLogs(job);
    setLoadingLogs(true);
    setLogs([]);

    workerGetJobLogs(workerUrl(), apiKey(), job.id).match(
      (list) => {
        setLogs(list);
        setLoadingLogs(false);
      },
      (err) => {
        setLoadingLogs(false);
        toast.error(`Failed to load logs: ${err.message}`);
      }
    );
  };

  const handleDownloadFromVPS = (job: WorkerJob) => {
    const filename = `vod_${job.vod_id}.mp4`;
    const outDir = props.settings.output_dir || "C:\\Users\\parac\\Videos";
    const dest = `${outDir}\\${filename}`;

    setDownloadingJobId(job.id);
    setDownloadPercent(0);
    toast.info(`Downloading ${filename} from VPS to ${dest}...`);

    workerDownloadFile(workerUrl(), apiKey(), job.id, dest).match(
      () => {
        toast.success(`Downloaded ${filename} successfully!`);
        setDownloadingJobId(null);
      },
      (err) => {
        toast.error(`Download failed: ${err.message}`);
        setDownloadingJobId(null);
      }
    );
  };

  const copyDockerCompose = () => {
    const yaml = `services:
  twitch-vod-worker:
    image: ghcr.io/your-username/twitch-vod-worker:latest # or build from crates/worker/Dockerfile
    container_name: twitch-vod-worker
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - WORKER_PORT=8080
      - WORKER_API_KEY=${apiKey() || "your_secret_api_key_here"}
      - DATA_DIR=/data
    volumes:
      - ./data:/data`;
    navigator.clipboard.writeText(yaml);
    toast.success("docker-compose.yml copied to clipboard!");
  };

  const formatStatusBadge = (s: WorkerJob["status"]) => {
    switch (s) {
      case "completed":
        return <Badge variant="success">Completed</Badge>;
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      case "cancelled":
        return <Badge variant="secondary">Cancelled</Badge>;
      case "queued":
        return <Badge variant="outline">Queued</Badge>;
      default:
        return (
          <Badge variant="default" class="gap-1 animate-pulse">
            <span class="i-mdi-loading animate-spin size-3" />
            {s}
          </Badge>
        );
    }
  };

  return (
    <div class="space-y-5 max-w-6xl pb-10">
      {/* Header */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <span class="i-mdi-server-network text-primary size-6" />
            Cloud Workers (Self-Hosted VPS)
          </h2>
          <p class="text-xs text-muted-foreground">
            Execute VOD archiving and autonomous stream monitoring 24/7 on your own Virtual Private Server.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setGuideOpen(true)}
            class="gap-1.5 text-xs h-8"
          >
            <span class="i-mdi-book-open-outline size-4" />
            VPS Setup Guide
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={refreshAll}
            disabled={loadingStatus()}
            class="gap-1.5 text-xs h-8"
          >
            <span
              class={`i-mdi-refresh size-4 ${loadingStatus() ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Connection & Status Banner */}
      <Show
        when={workerUrl()}
        fallback={
          <div class="p-8 text-center border rounded-xl bg-card/40 space-y-3">
            <div class="size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <span class="i-mdi-server-off size-6" />
            </div>
            <div>
              <h3 class="font-bold text-sm text-foreground">No VPS Worker Configured</h3>
              <p class="text-xs text-muted-foreground max-w-md mx-auto pt-1">
                Configure your VPS worker URL and secret API key in Settings to offload stream downloads and run autonomous archiving.
              </p>
            </div>
            <div class="flex justify-center gap-2 pt-2">
              <Button size="sm" onClick={props.onOpenSettings} class="gap-1.5">
                <span class="i-mdi-cog size-4" />
                Configure Worker in Settings
              </Button>
              <Button variant="outline" size="sm" onClick={() => setGuideOpen(true)} class="gap-1.5">
                <span class="i-mdi-help-circle size-4" />
                How to Host on VPS
              </Button>
            </div>
          </div>
        }
      >
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Card 1: Server Status */}
          <Card class="bg-card/60 backdrop-blur-xs">
            <CardHeader class="pb-2">
              <CardTitle class="text-xs text-muted-foreground flex items-center justify-between">
                <span>Worker Connection</span>
                <span class={`size-2.5 rounded-full ${isOnline() ? "bg-emerald-500 animate-pulse" : "bg-destructive"}`} />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div class="text-lg font-bold text-foreground flex items-center gap-2">
                {isOnline() ? "Online" : "Offline"}
                <Show when={pingLatency() !== null && isOnline()}>
                  <span class="text-xs font-normal text-muted-foreground font-mono">
                    ({pingLatency()}ms)
                  </span>
                </Show>
              </div>
              <p class="text-[11px] text-muted-foreground truncate pt-0.5" title={workerUrl()}>
                {workerUrl()}
              </p>
            </CardContent>
          </Card>

          {/* Card 2: CPU & Memory */}
          <Card class="bg-card/60 backdrop-blur-xs">
            <CardHeader class="pb-2">
              <CardTitle class="text-xs text-muted-foreground flex items-center justify-between">
                <span>VPS System Vitals</span>
                <span class="i-mdi-cpu-64-bit size-4 text-primary" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Show
                when={status()}
                fallback={<div class="text-xs text-muted-foreground">Connecting...</div>}
              >
                <div class="text-sm font-bold text-foreground flex items-center justify-between">
                  <span>CPU: {Math.round(status()?.cpu_usage_percent || 0)}%</span>
                  <span>
                    RAM: {Math.round(((status()?.memory_used_mb || 0) / (status()?.memory_total_mb || 1)) * 100)}%
                  </span>
                </div>
                <div class="text-[11px] text-muted-foreground pt-0.5 font-mono">
                  {status()?.memory_used_mb}MB / {status()?.memory_total_mb}MB
                </div>
              </Show>
            </CardContent>
          </Card>

          {/* Card 3: Storage & FFmpeg */}
          <Card class="bg-card/60 backdrop-blur-xs">
            <CardHeader class="pb-2">
              <CardTitle class="text-xs text-muted-foreground flex items-center justify-between">
                <span>Disk & FFmpeg</span>
                <span class="i-mdi-harddisk size-4 text-primary" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Show
                when={status()}
                fallback={<div class="text-xs text-muted-foreground">Connecting...</div>}
              >
                <div class="text-sm font-bold text-foreground flex items-center justify-between">
                  <span>{status()?.disk_free_gb} GB free</span>
                  <span class="text-xs text-emerald-500 flex items-center gap-1 font-normal">
                    <span class="i-mdi-check-circle size-3.5" /> FFmpeg OK
                  </span>
                </div>
                <div class="text-[11px] text-muted-foreground pt-0.5">
                  Total disk: {status()?.disk_total_gb} GB
                </div>
              </Show>
            </CardContent>
          </Card>

          {/* Card 4: Autonomous Watcher */}
          <Card class="bg-card/60 backdrop-blur-xs">
            <CardHeader class="pb-2">
              <CardTitle class="text-xs text-muted-foreground flex items-center justify-between">
                <span>Auto-Watcher</span>
                <span class="i-mdi-robot size-4 text-primary" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div class="flex items-center justify-between">
                <div class="text-sm font-bold text-foreground">
                  {status()?.auto_watcher_enabled ? "Active" : "Disabled"}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTriggerWatcher}
                  disabled={checkingWatcher() || !isOnline()}
                  class="h-7 text-[11px] gap-1 px-2"
                >
                  <span class={`i-mdi-sync size-3 ${checkingWatcher() ? "animate-spin" : ""}`} />
                  Check Now
                </Button>
              </div>
              <p class="text-[11px] text-muted-foreground pt-0.5">
                {status()?.auto_watcher_enabled
                  ? "Monitoring channel for new streams"
                  : "Turn on in Settings"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Sync Action Banner */}
        <div class="p-3 rounded-lg border bg-muted/30 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <span class="i-mdi-cloud-sync text-primary size-5" />
            <div class="text-xs">
              <span class="font-semibold text-foreground">Sync Credentials: </span>
              <span class="text-muted-foreground">
                Push your Twitch tokens and S3 bucket credentials from this computer to the VPS worker.
              </span>
            </div>
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={handleSyncSettings}
            disabled={syncing() || !isOnline()}
            class="gap-1.5 text-xs h-7"
          >
            <span class={`i-mdi-sync size-3.5 ${syncing() ? "animate-spin" : ""}`} />
            {syncing() ? "Syncing..." : "Sync Settings to VPS"}
          </Button>
        </div>

        {/* VPS Job Queue & History */}
        <div class="space-y-3 pt-2">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-bold text-foreground flex items-center gap-2">
              <span class="i-mdi-format-list-bulleted size-4" />
              VPS Execution Queue & History ({jobs().length})
            </h3>
            <Show when={loadingJobs()}>
              <span class="text-xs text-muted-foreground flex items-center gap-1">
                <span class="i-mdi-loading animate-spin size-3" /> Refreshing jobs...
              </span>
            </Show>
          </div>

          <Show
            when={jobs().length > 0}
            fallback={
              <div class="p-12 text-center border rounded-xl bg-card/30 space-y-2">
                <span class="i-mdi-tray-remove size-8 text-muted-foreground mx-auto" />
                <p class="text-sm font-medium text-foreground">No jobs on this worker yet</p>
                <p class="text-xs text-muted-foreground">
                  Archive a VOD and select "Cloud VPS Worker" to offload tasks to your server.
                </p>
              </div>
            }
          >
            <div class="space-y-2.5">
              <For each={jobs()}>
                {(job) => (
                  <div class="p-3.5 rounded-xl border bg-card/60 backdrop-blur-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-border transition-colors">
                    <div class="space-y-1 min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        {formatStatusBadge(job.status)}
                        <span class="font-semibold text-xs text-foreground truncate" title={job.title}>
                          {job.title}
                        </span>
                        <span class="text-[10px] text-muted-foreground font-mono shrink-0">
                          #{job.vod_id}
                        </span>
                      </div>

                      {/* Progress bar if active */}
                      <Show when={job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled"}>
                        <div class="space-y-1 pt-1 max-w-md">
                          <div class="flex justify-between text-[11px] text-muted-foreground font-mono">
                            <span>Stage: {job.stage}</span>
                            <span>{Math.round(job.progress_percent)}%</span>
                          </div>
                          <div class="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              class="h-full bg-primary transition-all duration-300"
                              style={{ width: `${job.progress_percent}%` }}
                            />
                          </div>
                        </div>
                      </Show>

                      <Show when={job.error}>
                        <p class="text-xs text-destructive pt-0.5 truncate">{job.error}</p>
                      </Show>

                      <div class="flex items-center gap-3 text-[10px] text-muted-foreground pt-0.5">
                        <span>Created: {new Date(job.created_at).toLocaleString()}</span>
                        <Show when={job.s3_key}>
                          <span>•</span>
                          <span class="text-emerald-500 flex items-center gap-1 font-mono">
                            <span class="i-mdi-cloud-check size-3" />
                            {job.s3_key}
                          </span>
                        </Show>
                      </div>
                    </div>

                    {/* Actions */}
                    <div class="flex items-center gap-1.5 shrink-0">
                      {/* View Logs Button */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenLogs(job)}
                        class="h-7 text-xs gap-1 px-2.5"
                      >
                        <span class="i-mdi-script-text-outline size-3.5" />
                        Logs
                      </Button>

                      {/* Direct Download to PC Button */}
                      <Show when={job.status === "completed" && job.local_path}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleDownloadFromVPS(job)}
                          disabled={downloadingJobId() === job.id}
                          class="h-7 text-xs gap-1 px-2.5"
                          title="Download compressed MP4 directly from VPS to PC"
                        >
                          <span class="i-mdi-download size-3.5" />
                          {downloadingJobId() === job.id
                            ? `${downloadPercent()}%`
                            : "Download to PC"}
                        </Button>
                      </Show>

                      {/* Cancel Active Job Button */}
                      <Show when={job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled"}>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleCancelJob(job.id)}
                          class="h-7 text-xs gap-1 px-2"
                        >
                          <span class="i-mdi-stop size-3.5" />
                          Cancel
                        </Button>
                      </Show>

                      {/* Delete History Button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteJob(job.id)}
                        class="h-7 size-7 p-0 text-muted-foreground hover:text-destructive"
                        title="Remove record"
                      >
                        <span class="i-mdi-delete-outline size-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      {/* Logs Viewer Modal */}
      <Dialog open={Boolean(selectedJobForLogs())} onOpenChange={(open) => !open && setSelectedJobForLogs(null)}>
        <DialogContent class="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2 text-sm">
              <span class="i-mdi-script-text text-primary size-5" />
              VPS Execution Logs: #{selectedJobForLogs()?.vod_id}
            </DialogTitle>
            <DialogDescription class="truncate">
              {selectedJobForLogs()?.title}
            </DialogDescription>
          </DialogHeader>

          <div class="flex-1 overflow-y-auto p-3 rounded-lg bg-black/90 font-mono text-[11px] text-emerald-400 space-y-1 min-h-[300px] border border-border/40">
            <Show
              when={!loadingLogs()}
              fallback={
                <div class="flex items-center justify-center h-full text-muted-foreground">
                  <span class="i-mdi-loading animate-spin size-5 mr-2" />
                  Loading logs from VPS...
                </div>
              }
            >
              <Show
                when={logs().length > 0}
                fallback={<div class="text-muted-foreground p-4 text-center">No logs recorded for this job.</div>}
              >
                <For each={logs()}>
                  {(l) => (
                    <div class="leading-relaxed">
                      <span class="text-muted-foreground mr-2">[{new Date(l.timestamp).toLocaleTimeString()}]</span>
                      <span>{l.message}</span>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSelectedJobForLogs(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VPS Deployment Guide Modal */}
      <Dialog open={guideOpen()} onOpenChange={(open) => !open && setGuideOpen(false)}>
        <DialogContent class="sm:max-w-xl max-h-[85vh] overflow-y-auto space-y-4">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <span class="i-mdi-server text-primary size-5" />
              Deploy Cloud Worker on Your VPS
            </DialogTitle>
            <DialogDescription>
              Host your own worker on Ubuntu, Debian, Hetzner, DigitalOcean, or any Linux server.
            </DialogDescription>
          </DialogHeader>

          <div class="space-y-4 text-xs">
            <div class="space-y-2">
              <h4 class="font-bold text-foreground text-sm flex items-center gap-1.5">
                <span class="i-mdi-docker text-blue-500 size-4" />
                Option 1: 1-Click Docker Compose (Recommended)
              </h4>
              <p class="text-muted-foreground">
                In the repository's <code>crates/worker/</code> folder on your VPS, create a <code>docker-compose.yml</code> and run:
              </p>
              <div class="relative">
                <pre class="p-3 rounded-lg bg-muted font-mono text-[11px] overflow-x-auto text-foreground">
                  docker compose up -d --build
                </pre>
                <Button
                  size="sm"
                  variant="secondary"
                  class="absolute top-2 right-2 text-[10px] h-6 px-2 gap-1"
                  onClick={copyDockerCompose}
                >
                  <span class="i-mdi-content-copy size-3" />
                  Copy docker-compose.yml
                </Button>
              </div>
            </div>

            <div class="space-y-2 pt-2 border-t">
              <h4 class="font-bold text-foreground text-sm flex items-center gap-1.5">
                <span class="i-mdi-linux size-4" />
                Option 2: Native Binary with Systemd
              </h4>
              <p class="text-muted-foreground">
                Install FFmpeg and run the compiled Rust binary as a background systemd service:
              </p>
              <pre class="p-3 rounded-lg bg-muted font-mono text-[11px] overflow-x-auto text-foreground">
{`sudo apt update && sudo apt install -y ffmpeg
cargo build --release -p vod-worker
sudo cp target/release/vod-worker /usr/local/bin/
sudo systemctl enable --now twitch-vod-worker`}
              </pre>
            </div>

            <div class="p-3 rounded-lg bg-primary/10 border border-primary/20 space-y-1">
              <p class="font-semibold text-foreground">Next Step:</p>
              <p class="text-muted-foreground">
                Once the worker is running, enter its address (e.g. <code>http://YOUR_VPS_IP:8080</code>) and API Key in this app's <strong>Settings</strong> tab, then click <strong>"Sync Settings to VPS"</strong>.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="default" size="sm" onClick={() => setGuideOpen(false)}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
