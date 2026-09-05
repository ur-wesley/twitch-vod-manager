import type { Component } from "solid-js";
import { createSignal, Show } from "solid-js";
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
import { installUpdate, type UpdateInfoDto } from "~/services/tauri";

const SKIPPED_VERSION_KEY = "twitch-vod-manager:skipped-update";

export function getSkippedVersion(): string | null {
  return localStorage.getItem(SKIPPED_VERSION_KEY);
}

export function setSkippedVersion(version: string): void {
  localStorage.setItem(SKIPPED_VERSION_KEY, version);
}

export interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateInfo: UpdateInfoDto | null;
}

export const UpdateDialog: Component<UpdateDialogProps> = (props) => {
  const [installing, setInstalling] = createSignal(false);

  const handleSkip = () => {
    const info = props.updateInfo;
    if (info) {
      setSkippedVersion(info.version);
    }
    props.onOpenChange(false);
  };

  const handleInstall = () => {
    setInstalling(true);
    installUpdate().match(
      () => {
        toast.info("Installing update, app will restart…");
      },
      (err) => {
        setInstalling(false);
        toast.error(err.message);
      }
    );
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <span class="i-mdi-download-circle-outline size-5" aria-hidden="true" />
            Update available
          </DialogTitle>
          <Show when={props.updateInfo}>
            {(info) => (
              <DialogDescription>New version: v{info().version}</DialogDescription>
            )}
          </Show>
        </DialogHeader>

        <Show when={props.updateInfo?.notes}>
          <pre class="max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-muted/30 p-3 text-xs whitespace-pre-wrap">
            {props.updateInfo!.notes}
          </pre>
        </Show>

        <DialogFooter>
          <Button variant="outline" onClick={handleSkip} disabled={installing()}>
            Skip this version
          </Button>
          <Button onClick={handleInstall} disabled={installing()} class="gap-1.5">
            <Show
              when={installing()}
              fallback={<span class="i-mdi-download-circle-outline size-4" aria-hidden="true" />}
            >
              <span class="i-mdi-loading size-4 animate-spin" aria-hidden="true" />
            </Show>
            Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
