import { type Component, createSignal, onCleanup, onMount, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";

export interface WindowTitleBarProps {
  title?: string;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
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
      <div class="flex items-center gap-2">
        <Show when={props.onToggleSidebar}>
          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={() => props.onToggleSidebar?.()}
            class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
            title={props.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            aria-label={props.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            aria-expanded={!props.sidebarCollapsed}
          >
            <span
              class={
                props.sidebarCollapsed
                  ? "iconify mdi--menu size-4"
                  : "iconify mdi--menu-open size-4"
              }
            />
          </button>
        </Show>

        <div data-tauri-drag-region class="flex items-center gap-2.5">
          <div class="pointer-events-none flex items-center justify-center size-5 rounded bg-primary/20 text-primary">
            <span class="iconify mdi--video-vintage text-xs" />
          </div>
          <span class="pointer-events-none text-xs font-bold tracking-tight text-foreground/90 font-heading">
            {props.title || "Twitch VOD Manager"}
          </span>
        </div>
      </div>

      <div data-tauri-drag-region class="flex-1 h-full" />

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
