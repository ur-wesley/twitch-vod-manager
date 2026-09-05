import type { Component } from "solid-js";
import { Show } from "solid-js";
import { Button } from "~/components/ui/button";
import type { TwitchUser } from "~/types";

export interface UserProfileProps {
  user: TwitchUser | null;
  loading: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

export const UserProfile: Component<UserProfileProps> = (props) => {
  return (
    <div class="w-full">
      <Show
        when={props.user}
        fallback={
          <Button
            variant="default"
            size="sm"
            onClick={props.onLogin}
            disabled={props.loading}
            class="w-full bg-[#9146FF] hover:bg-[#772ce8] text-white gap-2 font-medium"
          >
            <span class="i-mdi-twitch size-4" aria-hidden="true" />
            {props.loading ? "Connecting..." : "Login with Twitch"}
          </Button>
        }
      >
        {(user) => (
          <div class="flex w-full items-center gap-3 rounded-lg bg-sidebar-accent/60 px-2.5 py-2">
            <img
              src={user().profile_image_url}
              alt={user().display_name}
              class="size-8 shrink-0 rounded-full object-cover border border-primary/30"
            />
            <div class="flex min-w-0 flex-1 flex-col text-left leading-tight">
              <span class="truncate text-xs font-semibold text-foreground">
                {user().display_name}
              </span>
              <span class="truncate text-[10px] text-muted-foreground">@{user().login}</span>
            </div>
            <button
              type="button"
              onClick={props.onLogout}
              class="shrink-0 text-muted-foreground hover:text-destructive transition-colors cursor-pointer p-1 rounded"
              title="Logout"
            >
              <span class="i-mdi-logout size-3.5" aria-hidden="true" />
              <span class="sr-only">Logout</span>
            </button>
          </div>
        )}
      </Show>
    </div>
  );
};
