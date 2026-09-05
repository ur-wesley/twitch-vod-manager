import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { formatBytes, formatDate } from "~/lib/utils";
import type { S3Object } from "~/types";

export interface CloudLibraryProps {
  objects: S3Object[];
  loading: boolean;
  onRefresh: () => void;
  onDownload: (objectKey: string) => void;
  onPublishYouTube: (objectKey: string) => void;
  onDelete: (objectKey: string) => void;
}

export const CloudLibrary: Component<CloudLibraryProps> = (props) => {
  const [searchQuery, setSearchQuery] = createSignal("");

  const filteredObjects = () => {
    const q = searchQuery().toLowerCase();
    if (!q) return props.objects;
    return props.objects.filter((obj) => obj.key.toLowerCase().includes(q));
  };

  const totalStorageBytes = () =>
    props.objects.reduce((acc, obj) => acc + obj.size_bytes, 0);

  return (
    <div class="space-y-4">
      {/* Header Summary & Search */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card/60 border rounded-xl p-4 shadow-xs">
        <div class="space-y-0.5">
          <div class="flex items-center gap-2">
            <h3 class="font-semibold text-base text-foreground">Cloud Storage Library</h3>
            <Badge variant="secondary" class="text-xs">
              {props.objects.length} VODs
            </Badge>
          </div>
          <p class="text-xs text-muted-foreground">
            Total stored: <span class="font-medium text-foreground">{formatBytes(totalStorageBytes())}</span>
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
            onClick={props.onRefresh}
            disabled={props.loading}
            class="h-9 gap-1.5"
          >
            <span
              class={`i-mdi-refresh size-4 ${props.loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* VOD List */}
      <Show
        when={!props.loading || props.objects.length > 0}
        fallback={
          <div class="p-12 text-center text-muted-foreground space-y-2">
            <span class="i-mdi-loading animate-spin size-6 text-primary mx-auto" />
            <p class="text-xs">Loading files from your cloud bucket...</p>
          </div>
        }
      >
        <Show
          when={filteredObjects().length > 0}
          fallback={
            <div class="p-12 text-center border rounded-xl bg-card/30 space-y-2">
              <span class="i-mdi-cloud-outline size-8 text-muted-foreground mx-auto" />
              <p class="text-sm font-medium text-foreground">No archived VODs in cloud bucket</p>
              <p class="text-xs text-muted-foreground max-w-sm mx-auto">
                Archive broadcasts from the Twitch VODs tab to store them in your cheap S3-compatible cloud storage.
              </p>
            </div>
          }
        >
          <div class="grid grid-cols-1 gap-2.5">
            <For each={filteredObjects()}>
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
    </div>
  );
};
