import type { Component } from "solid-js";
import { Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { formatDate, formatDuration } from "~/lib/utils";
import type { TwitchVod } from "~/types";

export interface VodCardProps {
  vod: TwitchVod;
  onSelect: (vod: TwitchVod) => void;
  onDelete?: (vod: TwitchVod) => void;
  canDelete?: boolean;
  isProcessing?: boolean;
  isArchived?: boolean;
}

export const VodCard: Component<VodCardProps> = (props) => {
  // Format Twitch thumbnail template (%{width}x%{height})
  const thumbnailSrc = () =>
    props.vod.thumbnail_url.replace("%{width}", "480").replace("%{height}", "270");

  return (
    <Card class="overflow-hidden group hover:border-primary/50 transition-all hover:shadow-md bg-card/60 backdrop-blur-xs flex flex-col">
      <div class="relative aspect-video w-full bg-muted/80 overflow-hidden">
        <img
          src={thumbnailSrc()}
          alt={props.vod.title}
          class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
        />
        <div class="absolute bottom-2 right-2 flex items-center gap-1.5">
          <Badge
            variant="default"
            class="bg-black/80 backdrop-blur-xs text-white text-[11px] px-1.5 py-0.5 border-0 font-mono"
          >
            {formatDuration(props.vod.duration)}
          </Badge>
        </div>
        <div class="absolute top-2 left-2 flex items-center gap-1.5">
          <Badge
            variant={props.vod.viewable === "public" ? "success" : "warning"}
            class="text-[10px] capitalize px-1.5 py-0.5 backdrop-blur-xs"
          >
            {props.vod.viewable}
          </Badge>

          <Show when={props.isArchived}>
            <span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-500/90 text-white backdrop-blur-xs shadow-xs">
              <span class="i-mdi-cloud-check size-3" />
              Archived
            </span>
          </Show>

          <Show when={props.isProcessing}>
            <span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-primary/90 text-primary-foreground backdrop-blur-xs animate-pulse shadow-xs">
              <span class="i-mdi-loading animate-spin size-3" />
              Active
            </span>
          </Show>
        </div>
      </div>

      <CardContent class="p-3.5 flex flex-col flex-1 justify-between gap-3">
        <div class="space-y-1">
          <h4
            class="font-semibold text-sm line-clamp-2 text-foreground leading-snug group-hover:text-primary transition-colors"
            title={props.vod.title}
          >
            {props.vod.title}
          </h4>
          <div class="flex items-center gap-2 text-xs text-muted-foreground pt-0.5">
            <span class="flex items-center gap-1">
              <span class="i-mdi-calendar size-3.5" aria-hidden="true" />
              {formatDate(props.vod.created_at)}
            </span>
            <span>•</span>
            <span class="flex items-center gap-1">
              <span class="i-mdi-eye size-3.5" aria-hidden="true" />
              {props.vod.view_count.toLocaleString()}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2 pt-1 border-t border-border/40">
          <Button
            variant="default"
            size="sm"
            class="flex-1 gap-1.5 text-xs h-8"
            onClick={() => props.onSelect(props.vod)}
            disabled={props.isProcessing}
          >
            <span class="i-mdi-cloud-upload size-3.5" aria-hidden="true" />
            Archive VOD
          </Button>

          <Show when={props.canDelete && props.onDelete}>
            <button
              type="button"
              onClick={() => props.onDelete?.(props.vod)}
              class="inline-flex items-center justify-center size-8 rounded-md border border-input bg-background hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0 cursor-pointer"
              title="Delete from Twitch"
            >
              <span class="i-mdi-delete-outline size-4" aria-hidden="true" />
            </button>
          </Show>

          <a
            href={props.vod.url}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center size-8 rounded-md border border-input bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Open on Twitch"
          >
            <span class="i-mdi-open-in-new size-4" aria-hidden="true" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
};
