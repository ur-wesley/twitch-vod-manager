import { type Component, createSignal, onCleanup, onMount } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";

export interface WindowTitleBarProps {
  title?: string;
  version?: string;
}

export const WindowTitleBar: Component<WindowTitleBarProps> = (props) => {
  const [maximized, setMaximized] = createSignal(false);

  onMount(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    appWindow.isMaximized().then(setMaximized).catch(() => {});

    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setMaximized).catch(() => {});
    });

    onCleanup(() => {
      void unlisten.then((fn) => fn());
    });
  });

  const handleMinimize = async () => {
    if (!isTauri()) return;
    await getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    if (!isTauri()) return;
    await getCurrentWindow().toggleMaximize();
    const isMax = await getCurrentWindow().isMaximized();
    setMaximized(isMax);
  };

  const handleClose = async () => {
    if (!isTauri()) return;
    await getCurrentWindow().close();
  };

  return (
    <header
      data-tauri-drag-region
      class="flex h-9 select-none items-center justify-between border-b border-border/60 bg-sidebar px-3 text-sidebar-foreground z-50 shrink-0"
    >
      {/* App brand & title */}
      <div data-tauri-drag-region class="flex items-center gap-2.5 pointer-events-none">
        <div class="flex items-center justify-center size-5 rounded bg-primary/20 text-primary">
          <span class="iconify mdi--video-vintage text-xs" />
        </div>
        <span class="text-xs font-bold tracking-tight text-foreground/90 font-heading">
          {props.title || "Twitch VOD Manager"}
        </span>
        <span class="rounded bg-primary/10 px-1.5 py-0.2 text-[10px] font-bold text-primary font-mono">
          {props.version || "v0.1.0"}
        </span>
      </div>

      {/* Center drag spacer */}
      <div data-tauri-drag-region class="flex-1 h-full" />

      {/* Windows window controls */}
      <div class="flex h-full items-center -mr-3" data-tauri-drag-region="false">
        <button
          type="button"
          onClick={handleMinimize}
          class="flex h-full w-10 items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          title="Minimize"
          aria-label="Minimize"
        >
          <span class="iconify mdi--window-minimize text-sm" />
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          class="flex h-full w-10 items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          title={maximized() ? "Restore" : "Maximize"}
          aria-label={maximized() ? "Restore" : "Maximize"}
        >
          <span
            class={
              maximized()
                ? "iconify mdi--window-restore text-xs"
                : "iconify mdi--window-maximize text-xs"
            }
          />
        </button>
        <button
          type="button"
          onClick={handleClose}
          class="flex h-full w-10 items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
          title="Close"
          aria-label="Close"
        >
          <span class="iconify mdi--close text-sm" />
        </button>
      </div>
    </header>
  );
};
