import type { Component } from "solid-js";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { formatBytes, formatDate } from "~/lib/utils";
import type { GoogleDriveFile, S3Object, StorageQuota, WebDavFile } from "~/types";

type CloudProvider = "s3" | "gdrive" | "webdav";

const QuotaCard: Component<{
  icon: string;
  iconClass: string;
  label: string;
  loading?: boolean;
  listedBytes?: number;
  quotaUnknown?: boolean;
  quota?: StorageQuota | null;
}> = (props) => {
  const pctFree = () => {
    const q = props.quota;
    const total = q?.total_bytes;
    const available = q?.available_bytes;
    if (total == null || total === 0 || available == null) return null;
    return Math.max(0, Math.min(100, (available / total) * 100));
  };

  return (
    <Card class="bg-card/60 backdrop-blur-xs">
      <CardContent class="p-3 space-y-1.5">
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span class={`${props.icon} size-3.5 ${props.iconClass}`} aria-hidden="true" />
          <span class="font-semibold">{props.label}</span>
        </div>
        <Show
          when={!props.loading}
          fallback={<span class="i-mdi-loading animate-spin size-4 text-primary" aria-hidden="true" />}
        >
          <Show
            when={!props.quotaUnknown}
            fallback={
              <>
                <p class="text-sm font-bold text-foreground">
                  {formatBytes(props.listedBytes ?? 0)} listed
                </p>
                <p class="text-[11px] text-muted-foreground">quota unknown</p>
              </>
            }
          >
            <Show
              when={props.quota}
              fallback={<p class="text-xs text-muted-foreground">unavailable</p>}
            >
              {(q) => (
                <>
                  <p class="text-sm font-bold text-foreground">
                    {q().available_bytes != null
                      ? `${formatBytes(q().available_bytes ?? 0)} free`
                      : `${formatBytes(q().used_bytes)} used`}
                  </p>
                  <Show when={q().total_bytes != null}>
                    <p class="text-[11px] text-muted-foreground">
                      {formatBytes(q().used_bytes)} / {formatBytes(q().total_bytes ?? 0)}
                    </p>
                  </Show>
                  <Show when={pctFree() != null}>
                    <div class="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        class="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${pctFree() ?? 0}%` }}
                      />
                    </div>
                  </Show>
                </>
              )}
            </Show>
          </Show>
        </Show>
      </CardContent>
    </Card>
  );
};

export interface CloudLibraryProps {
  s3Configured?: boolean;
  gdriveConfigured?: boolean;
  webdavConfigured?: boolean;

  // S3 Storage
  objects: S3Object[];
  loading: boolean;
  onRefresh: () => void;
  onDownload: (objectKey: string) => void;
  onPublishYouTube: (objectKey: string) => void;
  onDelete: (objectKey: string) => void;

  // Google Drive
  gdriveFiles?: GoogleDriveFile[];
  loadingGdrive?: boolean;
  onRefreshGdrive?: () => void;
  onDownloadGdrive?: (file: GoogleDriveFile) => void;
  onPublishYouTubeGdrive?: (file: GoogleDriveFile) => void;
  onDeleteGdrive?: (fileId: string) => void;

  // WebDAV
  webdavFiles?: WebDavFile[];
  loadingWebdav?: boolean;
  onRefreshWebdav?: () => void;
  onDownloadWebdav?: (file: WebDavFile) => void;
  onPublishYouTubeWebdav?: (file: WebDavFile) => void;
  onDeleteWebdav?: (filenameOrHref: string) => void;

  gdriveQuota?: StorageQuota | null;
  loadingGdriveQuota?: boolean;
  webdavQuota?: StorageQuota | null;
  loadingWebdavQuota?: boolean;
}

export const CloudLibrary: Component<CloudLibraryProps> = (props) => {
  const configured = createMemo(() => {
    const list: CloudProvider[] = [];
    if (props.s3Configured) list.push("s3");
    if (props.gdriveConfigured) list.push("gdrive");
    if (props.webdavConfigured) list.push("webdav");
    return list;
  });

  const [provider, setProvider] = createSignal<CloudProvider>("s3");
  const [searchQuery, setSearchQuery] = createSignal("");

  createEffect(() => {
    const list = configured();
    if (list.length === 0) return;
    if (!list.includes(provider())) {
      setProvider(list[0]!);
    }
  });

  const s3List = () => props.objects;
  const gdriveList = () => props.gdriveFiles || [];
  const webdavList = () => props.webdavFiles || [];

  const filteredS3 = () => {
    const q = searchQuery().toLowerCase();
    if (!q) return s3List();
    return s3List().filter((obj) => obj.key.toLowerCase().includes(q));
  };

  const filteredGdrive = () => {
    const q = searchQuery().toLowerCase();
    if (!q) return gdriveList();
    return gdriveList().filter((f) => f.name.toLowerCase().includes(q));
  };

  const filteredWebdav = () => {
    const q = searchQuery().toLowerCase();
    if (!q) return webdavList();
    return webdavList().filter((f) => f.name.toLowerCase().includes(q));
  };

  const totalBytes = () => {
    switch (provider()) {
      case "s3":
        return s3List().reduce((acc, obj) => acc + obj.size_bytes, 0);
      case "gdrive":
        return gdriveList().reduce((acc, f) => acc + f.size_bytes, 0);
      case "webdav":
        return webdavList().reduce((acc, f) => acc + f.size_bytes, 0);
    }
  };

  const currentCount = () => {
    switch (provider()) {
      case "s3":
        return s3List().length;
      case "gdrive":
        return gdriveList().length;
      case "webdav":
        return webdavList().length;
    }
  };

  const isLoading = () => {
    switch (provider()) {
      case "s3":
        return props.loading;
      case "gdrive":
        return props.loadingGdrive ?? false;
      case "webdav":
        return props.loadingWebdav ?? false;
    }
  };

  const handleRefresh = () => {
    switch (provider()) {
      case "s3":
        props.onRefresh();
        break;
      case "gdrive":
        props.onRefreshGdrive?.();
        break;
      case "webdav":
        props.onRefreshWebdav?.();
        break;
    }
  };

  const s3ListedBytes = () =>
    s3List().reduce((acc, obj) => acc + obj.size_bytes, 0);

  const gridCols = () => {
    const n = configured().length;
    if (n <= 1) return "grid-cols-1";
    if (n === 2) return "grid-cols-1 sm:grid-cols-2";
    return "grid-cols-1 sm:grid-cols-3";
  };

  return (
    <div class="space-y-4">
      <Show
        when={configured().length > 0}
        fallback={
          <div class="p-12 text-center border rounded-xl bg-card/30 space-y-2">
            <span class="i-mdi-cloud-outline size-8 text-muted-foreground mx-auto" />
            <p class="text-sm font-medium text-foreground">No cloud storage configured</p>
            <p class="text-xs text-muted-foreground max-w-sm mx-auto">
              Configure S3, Google Drive, or WebDAV credentials in Settings to browse archived VODs.
            </p>
          </div>
        }
      >
      <div class={`grid ${gridCols()} gap-2`}>
        <Show when={props.s3Configured}>
          <QuotaCard
            icon="i-mdi-cloud-outline"
            iconClass="text-primary"
            label="S3 / Object Storage"
            listedBytes={s3ListedBytes()}
            quotaUnknown
          />
        </Show>
        <Show when={props.gdriveConfigured}>
          <QuotaCard
            icon="i-mdi-google-drive"
            iconClass="text-amber-500"
            label="Google Drive"
            loading={props.loadingGdriveQuota}
            quota={props.gdriveQuota}
          />
        </Show>
        <Show when={props.webdavConfigured}>
          <QuotaCard
            icon="i-mdi-folder-network"
            iconClass="text-blue-500"
            label="WebDAV / Nextcloud"
            loading={props.loadingWebdavQuota}
            quota={props.webdavQuota}
          />
        </Show>
      </div>

      <Show when={configured().length > 1}>
        <div class="flex items-center gap-2 p-1 bg-muted/40 rounded-xl border border-border/60 w-fit">
          <Show when={props.s3Configured}>
            <button
              type="button"
              onClick={() => {
                setProvider("s3");
                setSearchQuery("");
              }}
              class={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                provider() === "s3"
                  ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span class="i-mdi-cloud-outline size-4 text-primary" />
              <span>S3 / Object Storage</span>
              <Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-4">
                {s3List().length}
              </Badge>
            </button>
          </Show>

          <Show when={props.gdriveConfigured}>
            <button
              type="button"
              onClick={() => {
                setProvider("gdrive");
                setSearchQuery("");
                props.onRefreshGdrive?.();
              }}
              class={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                provider() === "gdrive"
                  ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span class="i-mdi-google-drive size-4 text-amber-500" />
              <span>Google Drive</span>
              <Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-4">
                {gdriveList().length}
              </Badge>
            </button>
          </Show>

          <Show when={props.webdavConfigured}>
            <button
              type="button"
              onClick={() => {
                setProvider("webdav");
                setSearchQuery("");
                props.onRefreshWebdav?.();
              }}
              class={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                provider() === "webdav"
                  ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span class="i-mdi-folder-network size-4 text-blue-500" />
              <span>WebDAV / Nextcloud</span>
              <Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-4">
                {webdavList().length}
              </Badge>
            </button>
          </Show>
        </div>
      </Show>

      {/* Header Summary & Search */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card/60 border rounded-xl p-4 shadow-xs">
        <div class="space-y-0.5">
          <div class="flex items-center gap-2">
            <h3 class="font-semibold text-base text-foreground">
              {provider() === "s3" && "S3 Cloud Bucket Library"}
              {provider() === "gdrive" && "Google Drive Archival Library"}
              {provider() === "webdav" && "WebDAV / Nextcloud Library"}
            </h3>
            <Badge variant="secondary" class="text-xs">
              {currentCount()} VODs
            </Badge>
          </div>
          <p class="text-xs text-muted-foreground">
            Total stored: <span class="font-medium text-foreground">{formatBytes(totalBytes())}</span>
          </p>
        </div>

        <div class="flex items-center gap-2">
          <div class="relative w-48 sm:w-64">
            <span class="i-mdi-magnify absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search VODs..."
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              class="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading()}
            class="h-9 gap-1.5"
          >
            <span
              class={`i-mdi-refresh size-4 ${isLoading() ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Loading State */}
      <Show when={isLoading() && currentCount() === 0}>
        <div class="p-12 text-center text-muted-foreground space-y-2">
          <span class="i-mdi-loading animate-spin size-6 text-primary mx-auto" />
          <p class="text-xs">Loading files from {provider()} storage...</p>
        </div>
      </Show>

      {/* S3 File List */}
      <Show when={props.s3Configured && provider() === "s3" && (!isLoading() || s3List().length > 0)}>
        <Show
          when={filteredS3().length > 0}
          fallback={
            <div class="p-12 text-center border rounded-xl bg-card/30 space-y-2">
              <span class="i-mdi-cloud-outline size-8 text-muted-foreground mx-auto" />
              <p class="text-sm font-medium text-foreground">No archived VODs in cloud bucket</p>
              <p class="text-xs text-muted-foreground max-w-sm mx-auto">
                Archive broadcasts from the Twitch VODs tab to store them in your S3 cloud bucket.
              </p>
            </div>
          }
        >
          <div class="grid grid-cols-1 gap-2.5">
            <For each={filteredS3()}>
              {(obj) => (
                <Card class="hover:border-border transition-all">
                  <CardContent class="p-3 flex items-center justify-between gap-4">
                    <div class="flex items-center gap-3 min-w-0">
                      <div class="size-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary">
                        <span class="i-mdi-video size-5" />
                      </div>
                      <div class="min-w-0">
                        <h4 class="text-sm font-medium text-foreground truncate" title={obj.key}>
                          {obj.key}
                        </h4>
                        <div class="flex items-center gap-2 text-xs text-muted-foreground pt-0.5">
                          <span>{formatBytes(obj.size_bytes)}</span>
                          <span>•</span>
                          <span>{formatDate(obj.last_modified)}</span>
                        </div>
                      </div>
                    </div>

                    <div class="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => props.onDownload(obj.key)}
                        class="gap-1.5 h-8 text-xs"
                      >
                        <span class="i-mdi-download size-3.5" aria-hidden="true" />
                        Download
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => props.onPublishYouTube(obj.key)}
                        class="gap-1.5 h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
                      >
                        <span class="i-mdi-youtube size-3.5" aria-hidden="true" />
                        To YouTube
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => props.onDelete(obj.key)}
                        class="size-8 text-muted-foreground hover:text-destructive"
                        title="Delete from bucket"
                      >
                        <span class="i-mdi-delete-outline size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </For>
          </div>
        </Show>
      </Show>

      {/* Google Drive File List */}
      <Show when={props.gdriveConfigured && provider() === "gdrive" && (!isLoading() || gdriveList().length > 0)}>
        <Show
          when={filteredGdrive().length > 0}
          fallback={
            <div class="p-12 text-center border rounded-xl bg-card/30 space-y-2">
              <span class="i-mdi-google-drive size-8 text-amber-500/60 mx-auto" />
              <p class="text-sm font-medium text-foreground">No VODs in Google Drive</p>
              <p class="text-xs text-muted-foreground max-w-sm mx-auto">
                Connect your Google Drive account in Settings and select Google Drive as an archive destination.
              </p>
            </div>
          }
        >
          <div class="grid grid-cols-1 gap-2.5">
            <For each={filteredGdrive()}>
              {(file) => (
                <Card class="hover:border-border transition-all">
                  <CardContent class="p-3 flex items-center justify-between gap-4">
                    <div class="flex items-center gap-3 min-w-0">
                      <div class="size-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 text-amber-500">
                        <span class="i-mdi-google-drive size-5" />
                      </div>
                      <div class="min-w-0">
                        <h4 class="text-sm font-medium text-foreground truncate" title={file.name}>
                          {file.name}
                        </h4>
                        <div class="flex items-center gap-2 text-xs text-muted-foreground pt-0.5">
                          <span>{formatBytes(file.size_bytes)}</span>
                          <span>•</span>
                          <span>{formatDate(file.modified_time)}</span>
                          <span class="font-mono text-[10px] text-muted-foreground/60 truncate max-w-[120px]">
                            ID: {file.id}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div class="flex items-center gap-2 shrink-0">
                      <Show when={file.web_view_link}>
                        <a
                          href={file.web_view_link}
                          target="_blank"
                          rel="noreferrer"
                          class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold border border-input bg-background hover:bg-muted/50 text-foreground transition-colors"
                        >
                          <span class="i-mdi-open-in-new size-3.5 text-muted-foreground" />
                          Open
                        </a>
                      </Show>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => props.onDownloadGdrive?.(file)}
                        class="gap-1.5 h-8 text-xs"
                      >
                        <span class="i-mdi-download size-3.5" aria-hidden="true" />
                        Download
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => props.onPublishYouTubeGdrive?.(file)}
                        class="gap-1.5 h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
                      >
                        <span class="i-mdi-youtube size-3.5" aria-hidden="true" />
                        To YouTube
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => props.onDeleteGdrive?.(file.id)}
                        class="size-8 text-muted-foreground hover:text-destructive"
                        title="Delete from Google Drive"
                      >
                        <span class="i-mdi-delete-outline size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </For>
          </div>
        </Show>
      </Show>

      {/* WebDAV File List */}
      <Show when={props.webdavConfigured && provider() === "webdav" && (!isLoading() || webdavList().length > 0)}>
        <Show
          when={filteredWebdav().length > 0}
          fallback={
            <div class="p-12 text-center border rounded-xl bg-card/30 space-y-2">
              <span class="i-mdi-folder-network size-8 text-blue-500/60 mx-auto" />
              <p class="text-sm font-medium text-foreground">No VODs found on WebDAV server</p>
              <p class="text-xs text-muted-foreground max-w-sm mx-auto">
                Configure your Nextcloud, ownCloud, or NAS WebDAV endpoint in Settings and select it as an archival target.
              </p>
            </div>
          }
        >
          <div class="grid grid-cols-1 gap-2.5">
            <For each={filteredWebdav()}>
              {(file) => (
                <Card class="hover:border-border transition-all">
                  <CardContent class="p-3 flex items-center justify-between gap-4">
                    <div class="flex items-center gap-3 min-w-0">
                      <div class="size-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 text-blue-500">
                        <span class="i-mdi-folder-network size-5" />
                      </div>
                      <div class="min-w-0">
                        <h4 class="text-sm font-medium text-foreground truncate" title={file.name}>
                          {file.name}
                        </h4>
                        <div class="flex items-center gap-2 text-xs text-muted-foreground pt-0.5">
                          <span>{formatBytes(file.size_bytes)}</span>
                          <span>•</span>
                          <span>{formatDate(file.last_modified)}</span>
                          <span class="font-mono text-[10px] text-muted-foreground/60 truncate max-w-[140px]" title={file.href}>
                            {file.href}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div class="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => props.onDownloadWebdav?.(file)}
                        class="gap-1.5 h-8 text-xs"
                      >
                        <span class="i-mdi-download size-3.5" aria-hidden="true" />
                        Download
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => props.onPublishYouTubeWebdav?.(file)}
                        class="gap-1.5 h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
                      >
                        <span class="i-mdi-youtube size-3.5" aria-hidden="true" />
                        To YouTube
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => props.onDeleteWebdav?.(file.href)}
                        class="size-8 text-muted-foreground hover:text-destructive"
                        title="Delete from WebDAV server"
                      >
                        <span class="i-mdi-delete-outline size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </For>
          </div>
        </Show>
      </Show>
      </Show>
    </div>
  );
};
