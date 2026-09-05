import { type Component, Show, createSignal } from "solid-js";
import { Button } from "~/components/ui/button";

export interface MissingToolsBannerProps {
  onOpenDownloader: () => void;
  onOpenSettings: () => void;
}

export const MissingToolsBanner: Component<MissingToolsBannerProps> = (props) => {
  const [dismissed, setDismissed] = createSignal(false);

  return (
    <Show when={!dismissed()}>
      <div class="relative flex items-center justify-between gap-4 border-b border-warning/30 bg-warning/10 px-4 py-2.5 text-warning-foreground animate-in fade-in slide-in-from-top duration-300">
        <div class="flex items-center gap-3 min-w-0">
          <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-warning/20 text-warning">
            <span class="iconify mdi--alert-outline size-4 text-amber-400" />
          </div>
          <div class="min-w-0">
            <p class="text-xs font-semibold text-amber-200">
              Missing Required Tool: <span class="font-mono font-bold text-white">FFmpeg</span>
            </p>
            <p class="text-[11px] text-amber-300/80 truncate">
              Twitch VOD Manager requires FFmpeg to merge video segments, compress streams, and publish archives.
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            onClick={props.onOpenDownloader}
            class="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-black font-bold shadow-sm"
          >
            <span class="iconify mdi--download mr-1.5 size-3.5" />
            Download & Install
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={props.onOpenSettings}
            class="h-7 text-xs text-amber-200 hover:text-white hover:bg-amber-500/20"
          >
            <span class="iconify mdi--cog-outline mr-1 size-3.5" />
            Configure
          </Button>

          <button
            type="button"
            onClick={() => setDismissed(true)}
            class="text-amber-400/60 hover:text-amber-200 p-1 transition-colors"
            title="Dismiss banner"
          >
            <span class="iconify mdi--close size-3.5" />
          </button>
        </div>
      </div>
    </Show>
  );
};
