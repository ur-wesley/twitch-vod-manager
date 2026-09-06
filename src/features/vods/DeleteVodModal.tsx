import type { Component } from "solid-js";
import { createSignal, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { deleteTwitchVod } from "~/services/tauri";
import type { TwitchVod } from "~/types";

export interface DeleteVodModalProps {
  vod: TwitchVod | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleted: (vodId: string) => void;
}

export const DeleteVodModal: Component<DeleteVodModalProps> = (props) => {
  const [deleting, setDeleting] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal("");

  const handleDelete = () => {
    if (!props.vod) return;
    setDeleting(true);
    setErrorMsg("");

    deleteTwitchVod(props.vod.id).match(
      () => {
        setDeleting(false);
        props.onDeleted(props.vod!.id);
        props.onClose();
      },
      (err) => {
        setDeleting(false);
        setErrorMsg(err.message);
      },
    );
  };

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => !open && !deleting() && props.onClose()}>
      <DialogContent class="sm:max-w-md w-full max-h-[calc(100vh-2rem)] overflow-y-auto">
        <DialogHeader class="pr-6">
          <DialogTitle class="flex items-center gap-2 text-destructive min-w-0">
            <span class="i-mdi-delete-alert size-5 shrink-0" aria-hidden="true" />
            <span class="truncate">Delete VOD from Twitch</span>
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground break-words">
            This action will permanently delete this broadcast archive from your Twitch channel.
          </DialogDescription>
        </DialogHeader>

        <Show when={props.vod}>
          <div class="space-y-3 py-1 min-w-0">
            <div class="flex items-center gap-3 p-2.5 rounded-lg border bg-muted/30 overflow-hidden min-w-0">
              <Show
                when={props.vod?.thumbnail_url}
                fallback={
                  <div class="w-16 h-10 rounded bg-muted flex items-center justify-center shrink-0" />
                }
              >
                <img
                  src={props.vod?.thumbnail_url
                    .replace("%{width}", "160")
                    .replace("%{height}", "90")}
                  alt={props.vod?.title}
                  class="w-16 h-10 object-cover rounded shrink-0"
                />
              </Show>
              <div class="min-w-0 flex-1 overflow-hidden">
                <p class="text-xs font-semibold text-foreground truncate" title={props.vod?.title}>
                  {props.vod?.title}
                </p>
                <p class="text-[11px] text-muted-foreground truncate">
                  Duration: {props.vod?.duration} • ID: #{props.vod?.id}
                </p>
              </div>
            </div>

            <div class="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-start gap-2 min-w-0">
              <span class="i-mdi-alert-circle size-4 shrink-0 mt-0.5" />
              <span class="break-words min-w-0 flex-1 leading-relaxed">
                <strong>Warning:</strong> Deleting a VOD on Twitch is permanent and cannot be
                undone. Make sure you have archived it to Cloud Storage or downloaded a copy first.
              </span>
            </div>

            <Show when={errorMsg()}>
              <div class="p-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive flex items-start gap-2 min-w-0 max-h-32 overflow-y-auto">
                <span class="i-mdi-alert-octagon size-4 shrink-0 mt-0.5" />
                <p class="break-all min-w-0 flex-1 leading-relaxed">{errorMsg()}</p>
              </div>
            </Show>
          </div>
        </Show>

        <DialogFooter class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={props.onClose}
            disabled={deleting()}
            class="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleting() || !props.vod}
            class="gap-1.5 w-full sm:w-auto shrink-0"
          >
            <span class="i-mdi-delete size-4" />
            {deleting() ? "Deleting from Twitch..." : "Delete Permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
