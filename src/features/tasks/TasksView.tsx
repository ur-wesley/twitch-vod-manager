import type { Component } from "solid-js";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { toast } from "solid-sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { PipelineMonitor, type PipelineStage } from "~/features/pipeline/PipelineMonitor";
import {
  workerCancelJob,
  workerDeleteJob,
  workerDownloadFile,
  workerGetJobLogs,
  workerListJobs,
} from "~/services/tauri";
import type {
  AppSettings,
  CompressionProgress,
  DownloadProgress,
  DriveTransferProgress,
  S3TransferProgress,
  WorkerJob,
  WorkerJobLog,
} from "~/types";

export interface LocalTaskRecord {
  id: string;
  vod_id: string;
  title: string;
  status: "running" | "completed" | "failed" | "cancelled";
  stage: string;
  preset?: string;
  crf?: number;
  started_at: string;
  completed_at?: string;
  error?: string;
  local_path?: string;
  s3_key?: string;
  gdrive_file_id?: string;
  gdrive_view_url?: string;
  webdav_path?: string;
  youtube_video_id?: string;
}

const LOCAL_TASKS_KEY = "tvm_local_tasks_history";

export function getLocalTasksHistory(): LocalTaskRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_TASKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveLocalTasksHistory(tasks: LocalTaskRecord[]) {
  try {
    localStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
  } catch {}
}

export function recordLocalTask(task: LocalTaskRecord) {
  const list = getLocalTasksHistory();
  const existingIdx = list.findIndex((t) => t.id === task.id || (t.vod_id === task.vod_id && t.status === "running"));
  if (existingIdx >= 0) {
    list[existingIdx] = { ...list[existingIdx], ...task };
  } else {
    list.unshift(task);
  }
  // Cap history at 50 tasks
  saveLocalTasksHistory(list.slice(0, 50));
}

export interface TasksViewProps {
  settings: AppSettings;
  pipelineStage: PipelineStage;
  activeVodId: string | null;
  downloadProgress: DownloadProgress | null;
  compressionProgress: CompressionProgress | null;
  s3Progress: S3TransferProgress | null;
  driveProgress: DriveTransferProgress | null;
  onCancelPipeline: () => void;
  onOpenSettings: () => void;
}

export const TasksView: Component<TasksViewProps> = (props) => {
  const [localTasks, setLocalTasks] = createSignal<LocalTaskRecord[]>(getLocalTasksHistory());
  const [workerJobs, setWorkerJobs] = createSignal<WorkerJob[]>([]);
  const [loadingWorkerJobs, setLoadingWorkerJobs] = createSignal(false);

  // Filters
  const [originFilter, setOriginFilter] = createSignal<"all" | "local" | "cloud">("all");
  const [statusFilter, setStatusFilter] = createSignal<"all" | "active" | "completed" | "failed">("all");
  const [searchQuery, setSearchQuery] = createSignal("");

  // Logs modal for worker jobs
  const [selectedJobForLogs, setSelectedJobForLogs] = createSignal<WorkerJob | null>(null);
  const [logs, setLogs] = createSignal<WorkerJobLog[]>([]);
  const [loadingLogs, setLoadingLogs] = createSignal(false);

  const workerConfigured = () => Boolean(props.settings?.worker_url?.trim());

  const refreshWorkerJobs = async () => {
    const url = props.settings?.worker_url?.trim();
    if (!url) return;
    setLoadingWorkerJobs(true);
    const res = await workerListJobs(url, props.settings?.worker_api_key);
    setLoadingWorkerJobs(false);
    res.match(
      (data) => {
        if (Array.isArray(data)) {
          setWorkerJobs(data as WorkerJob[]);
        }
      },
      () => {},
    );
  };

  const refreshAll = () => {
    setLocalTasks(getLocalTasksHistory());
    if (workerConfigured()) {
      void refreshWorkerJobs();
    }
  };

  onMount(() => {
    refreshAll();
    const interval = setInterval(() => {
      // Refresh local tasks from storage
      setLocalTasks(getLocalTasksHistory());
      // Poll worker jobs if worker is configured
      if (workerConfigured()) {
        const hasActiveWorker = workerJobs().some(
          (j) => j.status === "queued" || j.status === "downloading" || j.status === "compressing" || j.status === "uploading_s3" || j.status === "uploading_youtube",
        );
        if (hasActiveWorker || props.pipelineStage !== "idle") {
          void refreshWorkerJobs();
        }
      }
    }, 3500);

    onCleanup(() => clearInterval(interval));
  });

  const handleOpenLogs = async (job: WorkerJob) => {
    setSelectedJobForLogs(job);
    setLoadingLogs(true);
    setLogs([]);
    const url = props.settings?.worker_url?.trim();
    if (!url) return;
    const res = await workerGetJobLogs(url, props.settings?.worker_api_key, job.id);
    setLoadingLogs(false);
    res.match(
      (rawLogs) => {
        if (Array.isArray(rawLogs)) setLogs(rawLogs as WorkerJobLog[]);
      },
      (err) => toast.error(`Failed to load logs: ${err.message}`),
    );
  };

  const handleCancelWorkerJob = async (jobId: string) => {
    const url = props.settings?.worker_url?.trim();
    if (!url) return;
    const res = await workerCancelJob(url, props.settings?.worker_api_key, jobId);
    res.match(
      () => {
        toast.success(`Job #${jobId.slice(0, 8)} cancellation requested`);
        void refreshWorkerJobs();
      },
      (err) => toast.error(`Cancel failed: ${err.message}`),
    );
  };

  const handleDeleteWorkerJob = async (jobId: string) => {
    const url = props.settings?.worker_url?.trim();
    if (!url) return;
    const res = await workerDeleteJob(url, props.settings?.worker_api_key, jobId);
    res.match(
      () => {
        toast.success("Job record deleted");
        setWorkerJobs((prev) => prev.filter((j) => j.id !== jobId));
      },
      (err) => toast.error(`Delete failed: ${err.message}`),
    );
  };

  const handleDownloadWorkerFile = async (jobId: string, vodId: string) => {
    const url = props.settings?.worker_url?.trim();
    if (!url) return;
    toast.info(`Preparing download from worker for VOD #${vodId}...`);
    const res = await workerDownloadFile(url, props.settings?.worker_api_key, jobId, `vod_${vodId}.mp4`);
    res.match(
      () => toast.success(`Download started for VOD #${vodId}`),
      (err) => toast.error(`Download failed: ${err.message}`),
    );
  };

  const handleClearLocalHistory = () => {
    const active = localTasks().filter((t) => t.status === "running");
    saveLocalTasksHistory(active);
    setLocalTasks(active);
    toast.success("Cleared local task history");
  };

  // Aggregated task metrics
  const isLocalActive = () => props.pipelineStage !== "idle";
  const activeWorkerJobsCount = () =>
    workerJobs().filter(
      (j) =>
        j.status !== "completed" &&
        j.status !== "failed" &&
        j.status !== "cancelled",
    ).length;
  const totalActiveTasks = () => (isLocalActive() ? 1 : 0) + activeWorkerJobsCount();

  const completedCount = () =>
    localTasks().filter((t) => t.status === "completed").length +
    workerJobs().filter((j) => j.status === "completed").length;

  const failedCount = () =>
    localTasks().filter((t) => t.status === "failed").length +
    workerJobs().filter((j) => j.status === "failed").length;

  const totalTasksCount = () =>
    localTasks().length + workerJobs().length + (isLocalActive() ? 1 : 0);

  // Filtered lists
  const filteredWorkerJobs = () => {
    if (originFilter() === "local") return [];
    return workerJobs().filter((job) => {
      // Status filter
      if (statusFilter() === "active") {
        if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") return false;
      } else if (statusFilter() === "completed" && job.status !== "completed") {
        return false;
      } else if (statusFilter() === "failed" && job.status !== "failed") {
        return false;
      }
      // Search query
      const q = searchQuery().trim().toLowerCase();
      if (q && !job.title.toLowerCase().includes(q) && !job.vod_id.includes(q)) {
        return false;
      }
      return true;
    });
  };

  const filteredLocalTasks = () => {
    if (originFilter() === "cloud") return [];
    return localTasks().filter((task) => {
      // Status filter
      if (statusFilter() === "active") {
        if (task.status !== "running") return false;
      } else if (statusFilter() === "completed" && task.status !== "completed") {
        return false;
      } else if (statusFilter() === "failed" && task.status !== "failed") {
        return false;
      }
      // Search query
      const q = searchQuery().trim().toLowerCase();
      if (q && !task.title.toLowerCase().includes(q) && !task.vod_id.includes(q)) {
        return false;
      }
      return true;
    });
  };

  const formatStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge variant="success" class="gap-1 text-[11px]"><span class="i-mdi-check-circle size-3" /> Completed</Badge>;
      case "failed":
        return <Badge variant="destructive" class="gap-1 text-[11px]"><span class="i-mdi-alert-circle size-3" /> Failed</Badge>;
      case "cancelled":
        return <Badge variant="secondary" class="gap-1 text-[11px]"><span class="i-mdi-close-circle size-3" /> Cancelled</Badge>;
      case "queued":
        return <Badge variant="outline" class="gap-1 text-[11px]"><span class="i-mdi-clock-outline size-3" /> Queued</Badge>;
      default:
        return (
          <Badge variant="default" class="gap-1 text-[11px] bg-primary text-primary-foreground">
            <span class="i-mdi-loading animate-spin size-3" />
            <span class="capitalize">{status}</span>
          </Badge>
        );
    }
  };

  return (
    <div class="flex-1 overflow-y-auto p-6 space-y-6 max-w-6xl pb-16">
      {/* Header */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 font-heading">
            <span class="i-mdi-format-list-checks text-primary size-6" />
            Tasks & Queue
          </h2>
          <p class="text-xs text-muted-foreground pt-0.5">
            Monitor real-time progress and history for Local PC and Cloud VPS worker archiving jobs.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            disabled={loadingWorkerJobs()}
            class="h-8 gap-1.5 text-xs"
          >
            <span
              class={`size-3.5 ${loadingWorkerJobs() ? "i-mdi-loading animate-spin" : "i-mdi-refresh"}`}
            />
            Refresh
          </Button>

          <Show when={localTasks().length > 0}>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearLocalHistory}
              class="h-8 text-xs text-muted-foreground hover:text-destructive gap-1"
            >
              <span class="i-mdi-delete-sweep size-3.5" />
              Clear Local History
            </Button>
          </Show>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card class="bg-card/60 backdrop-blur-xs">
          <CardContent class="p-3.5 flex items-center justify-between">
            <div>
              <p class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Active Tasks</p>
              <p class="text-xl font-bold text-foreground pt-0.5">{totalActiveTasks()}</p>
            </div>
            <div class="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Show
                when={totalActiveTasks() > 0}
                fallback={<span class="i-mdi-progress-clock size-5" />}
              >
                <span class="i-mdi-loading animate-spin size-5 text-primary" />
              </Show>
            </div>
          </CardContent>
        </Card>

        <Card class="bg-card/60 backdrop-blur-xs">
          <CardContent class="p-3.5 flex items-center justify-between">
            <div>
              <p class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Completed</p>
              <p class="text-xl font-bold text-emerald-400 pt-0.5">{completedCount()}</p>
            </div>
            <div class="size-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <span class="i-mdi-check-circle size-5" />
            </div>
          </CardContent>
        </Card>

        <Card class="bg-card/60 backdrop-blur-xs">
          <CardContent class="p-3.5 flex items-center justify-between">
            <div>
              <p class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Failed / Errors</p>
              <p class="text-xl font-bold text-rose-400 pt-0.5">{failedCount()}</p>
            </div>
            <div class="size-9 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center">
              <span class="i-mdi-alert-circle size-5" />
            </div>
          </CardContent>
        </Card>

        <Card class="bg-card/60 backdrop-blur-xs">
          <CardContent class="p-3.5 flex items-center justify-between">
            <div>
              <p class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Total Recorded</p>
              <p class="text-xl font-bold text-foreground pt-0.5">{totalTasksCount()}</p>
            </div>
            <div class="size-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
              <span class="i-mdi-history size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Local Pipeline Monitor */}
      <Show when={isLocalActive()}>
        <div class="space-y-2">
          <div class="flex items-center gap-2 text-xs font-semibold text-primary">
            <span class="size-2 rounded-full bg-primary animate-ping" />
            <span>Active Local PC Pipeline Running</span>
          </div>
          <PipelineMonitor
            stage={props.pipelineStage}
            activeVodId={props.activeVodId}
            downloadProgress={props.downloadProgress}
            compressionProgress={props.compressionProgress}
            s3Progress={props.s3Progress}
            driveProgress={props.driveProgress}
            onCancel={props.onCancelPipeline}
          />
        </div>
      </Show>

      {/* Filters & Search Toolbar */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border bg-card/40 backdrop-blur-xs">
        <div class="flex flex-wrap items-center gap-2">
          {/* Origin Segmented Toggle */}
          <div class="flex items-center bg-muted/50 p-0.5 rounded-lg border border-border/40 text-xs">
            <button
              type="button"
              onClick={() => setOriginFilter("all")}
              class={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                originFilter() === "all"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Origins
            </button>
            <button
              type="button"
              onClick={() => setOriginFilter("local")}
              class={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1 ${
                originFilter() === "local"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span class="i-mdi-laptop size-3" />
              Local PC
            </button>
            <button
              type="button"
              onClick={() => setOriginFilter("cloud")}
              class={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1 ${
                originFilter() === "cloud"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span class="i-mdi-server-network size-3" />
              Cloud VPS
            </button>
          </div>

          {/* Status Segmented Toggle */}
          <div class="flex items-center bg-muted/50 p-0.5 rounded-lg border border-border/40 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              class={`px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
                statusFilter() === "all"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Status
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("active")}
              class={`px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
                statusFilter() === "active"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("completed")}
              class={`px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
                statusFilter() === "completed"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Completed
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("failed")}
              class={`px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
                statusFilter() === "failed"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Failed
            </button>
          </div>
        </div>

        {/* Search */}
        <div class="relative w-full sm:w-60">
          <span class="i-mdi-magnify absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Filter by VOD ID or title..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            class="h-8 pl-8 text-xs bg-muted/30"
          />
        </div>
      </div>

      {/* Cloud VPS Worker not configured notice if origin === cloud */}
      <Show when={!workerConfigured() && (originFilter() === "cloud" || originFilter() === "all")}>
        <div class="p-3.5 rounded-xl border border-border/40 bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div class="flex items-center gap-2.5">
            <span class="i-mdi-server-network-off size-5 text-muted-foreground shrink-0" />
            <span class="text-muted-foreground">
              Cloud Worker URL is not configured. Connect your VPS worker in Settings to view background cloud tasks.
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={props.onOpenSettings} class="h-7 text-xs shrink-0 gap-1">
            <span class="i-mdi-cog size-3.5" />
            Configure Worker
          </Button>
        </div>
      </Show>

      {/* Task List */}
      <div class="space-y-3">
        <h3 class="text-sm font-bold text-foreground flex items-center justify-between">
          <span>
            Tasks List ({filteredLocalTasks().length + filteredWorkerJobs().length})
          </span>
        </h3>

        <Show
          when={filteredLocalTasks().length > 0 || filteredWorkerJobs().length > 0}
          fallback={
            <div class="p-12 text-center border rounded-xl bg-card/30 space-y-2">
              <span class="i-mdi-tray-remove size-8 text-muted-foreground mx-auto" />
              <p class="text-sm font-medium text-foreground">No tasks found</p>
              <p class="text-xs text-muted-foreground">
                No matching tasks found for the current filters. Archive a VOD to get started.
              </p>
            </div>
          }
        >
          <div class="space-y-2.5">
            {/* Local Tasks */}
            <For each={filteredLocalTasks()}>
              {(task) => (
                <div class="p-3.5 rounded-xl border bg-card/60 backdrop-blur-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-border transition-colors">
                  <div class="space-y-1 min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
                        <span class="i-mdi-laptop size-3" />
                        Local PC
                      </span>
                      {formatStatusBadge(task.status)}
                      <span class="font-semibold text-xs text-foreground truncate" title={task.title}>
                        {task.title || `Twitch VOD #${task.vod_id}`}
                      </span>
                      <span class="text-[10px] text-muted-foreground font-mono shrink-0">
                        #{task.vod_id}
                      </span>
                    </div>

                    <Show when={task.error}>
                      <p class="text-xs text-destructive pt-0.5 truncate flex items-center gap-1">
                        <span class="i-mdi-alert-circle-outline size-3.5 shrink-0" />
                        <span class="truncate">{task.error}</span>
                      </p>
                    </Show>

                    <div class="flex items-center gap-3 text-[10px] text-muted-foreground pt-0.5 flex-wrap">
                      <span>Started: {new Date(task.started_at).toLocaleString()}</span>
                      <Show when={task.completed_at}>
                        <span>• Completed: {new Date(task.completed_at!).toLocaleString()}</span>
                      </Show>
                      <Show when={task.preset}>
                        <span>• Preset: {task.preset}</span>
                      </Show>
                      <Show when={task.local_path}>
                        <span class="text-emerald-400 flex items-center gap-1 font-mono truncate">
                          <span class="i-mdi-folder-check size-3 shrink-0" />
                          {task.local_path}
                        </span>
                      </Show>
                      <Show when={task.s3_key}>
                        <span class="text-sky-400 flex items-center gap-1 font-mono">
                          <span class="i-mdi-cloud-check size-3 shrink-0" />
                          S3: {task.s3_key}
                        </span>
                      </Show>
                      <Show when={task.gdrive_file_id}>
                        <span class="text-amber-400 flex items-center gap-1 font-mono">
                          <span class="i-mdi-google-drive size-3 shrink-0" />
                          Drive OK
                        </span>
                      </Show>
                    </div>
                  </div>
                </div>
              )}
            </For>

            {/* Cloud Worker Jobs */}
            <For each={filteredWorkerJobs()}>
              {(job) => {
                const isActive = () =>
                  job.status !== "completed" &&
                  job.status !== "failed" &&
                  job.status !== "cancelled";

                return (
                  <div class="p-3.5 rounded-xl border bg-card/60 backdrop-blur-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-border transition-colors">
                    <div class="space-y-1 min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <span class="i-mdi-server-network size-3" />
                          Cloud VPS
                        </span>
                        {formatStatusBadge(job.status)}
                        <span class="font-semibold text-xs text-foreground truncate" title={job.title}>
                          {job.title || `Twitch VOD #${job.vod_id}`}
                        </span>
                        <span class="text-[10px] text-muted-foreground font-mono shrink-0">
                          #{job.vod_id}
                        </span>
                      </div>

                      {/* Progress bar if active */}
                      <Show when={isActive()}>
                        <div class="space-y-1 pt-1 max-w-md">
                          <div class="flex justify-between text-[11px] text-muted-foreground font-mono">
                            <span class="flex items-center gap-1">
                              <span class="i-mdi-loading animate-spin size-3 text-primary" />
                              Stage: {job.stage}
                            </span>
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
                        <p
                          class="text-xs text-destructive pt-0.5 truncate cursor-pointer hover:underline flex items-center gap-1"
                          title={`${job.error} (Click to view full execution logs)`}
                          onClick={() => handleOpenLogs(job)}
                        >
                          <span class="i-mdi-alert-circle-outline size-3.5 shrink-0" />
                          <span class="truncate">{job.error}</span>
                        </p>
                      </Show>

                      <div class="flex items-center gap-3 text-[10px] text-muted-foreground pt-0.5 flex-wrap">
                        <span>Created: {new Date(job.created_at).toLocaleString()}</span>
                        <Show when={job.s3_key}>
                          <span class="text-sky-400 flex items-center gap-1 font-mono">
                            <span class="i-mdi-cloud-check size-3" /> S3: {job.s3_key}
                          </span>
                        </Show>
                        <Show when={job.gdrive_file_id}>
                          <span class="text-amber-400 flex items-center gap-1 font-mono">
                            <span class="i-mdi-google-drive size-3" /> Drive Uploaded
                          </span>
                        </Show>
                        <Show when={job.webdav_path}>
                          <span class="text-indigo-400 flex items-center gap-1 font-mono">
                            <span class="i-mdi-cloud-outline size-3" /> WebDAV
                          </span>
                        </Show>
                        <Show when={job.youtube_video_id}>
                          <span class="text-red-400 flex items-center gap-1 font-mono">
                            <span class="i-mdi-youtube size-3" /> YouTube: {job.youtube_video_id}
                          </span>
                        </Show>
                      </div>
                    </div>

                    {/* Actions */}
                    <div class="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenLogs(job)}
                        class="h-7 text-xs px-2 gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <span class="i-mdi-text-box-outline size-3.5" />
                        Logs
                      </Button>

                      <Show when={job.local_path && job.status === "completed"}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownloadWorkerFile(job.id, job.vod_id)}
                          class="h-7 text-xs px-2 gap-1"
                        >
                          <span class="i-mdi-download size-3.5" />
                          Download
                        </Button>
                      </Show>

                      <Show when={isActive()}>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleCancelWorkerJob(job.id)}
                          class="h-7 text-xs px-2 gap-1"
                        >
                          <span class="i-mdi-stop size-3.5" />
                          Cancel
                        </Button>
                      </Show>

                      <Show when={!isActive()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteWorkerJob(job.id)}
                          class="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          title="Delete job record"
                        >
                          <span class="i-mdi-trash-can-outline size-3.5" />
                        </Button>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>

      {/* Worker Job Logs Modal */}
      <Dialog
        open={Boolean(selectedJobForLogs())}
        onOpenChange={(open) => !open && setSelectedJobForLogs(null)}
      >
        <DialogContent class="sm:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader class="pb-2">
            <DialogTitle class="flex items-center justify-between text-sm">
              <span class="flex items-center gap-2">
                <span class="i-mdi-text-box-outline text-primary size-4" />
                Logs: {selectedJobForLogs()?.title || `#${selectedJobForLogs()?.vod_id}`}
              </span>
              <span class="text-xs font-mono text-muted-foreground font-normal">
                Job ID: #{selectedJobForLogs()?.id.slice(0, 8)}
              </span>
            </DialogTitle>
            <DialogDescription class="text-xs">
              Live stdout and stage messages from the cloud worker execution container.
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
                fallback={
                  <div class="text-muted-foreground p-4 text-center">
                    No logs recorded for this job.
                  </div>
                }
              >
                <For each={logs()}>
                  {(l) => {
                    const isError =
                      l.message.includes("❌") ||
                      l.message.toLowerCase().includes("failed") ||
                      l.message.toLowerCase().includes("error:");
                    const isWarning =
                      l.message.includes("⚠️") || l.message.toLowerCase().includes("warning");
                    const isSuccess =
                      l.message.includes("✅") || l.message.toLowerCase().includes("success");
                    return (
                      <div
                        class={`leading-relaxed whitespace-pre-wrap break-words ${
                          isError
                            ? "text-rose-400 bg-rose-950/20 p-1 rounded"
                            : isWarning
                              ? "text-amber-300"
                              : isSuccess
                                ? "text-emerald-300 font-semibold"
                                : "text-emerald-400"
                        }`}
                      >
                        <span class="text-muted-foreground mr-2 select-none">
                          [{new Date(l.timestamp).toLocaleTimeString()}]
                        </span>
                        <span>{l.message}</span>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </Show>
          </div>

          <DialogFooter class="flex items-center justify-between sm:justify-between w-full pt-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={loadingLogs()}
              onClick={() => {
                const job = selectedJobForLogs();
                if (job) handleOpenLogs(job);
              }}
              class="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
            >
              <span
                class={`size-3.5 ${loadingLogs() ? "i-mdi-loading animate-spin" : "i-mdi-refresh"}`}
              />
              Refresh Logs
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSelectedJobForLogs(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
