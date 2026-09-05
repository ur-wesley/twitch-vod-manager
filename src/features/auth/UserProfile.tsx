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
    <div class="flex items-center gap-3">
      <Show
        when={props.user}
        fallback={
          <Button
            variant="default"
            size="sm"
            onClick={props.onLogin}
            disabled={props.loading}
            class="bg-[#9146FF] hover:bg-[#772ce8] text-white gap-2 font-medium"
          >
            <span class="i-mdi-twitch size-4" aria-hidden="true" />
            {props.loading ? "Connecting..." : "Login with Twitch"}
          </Button>
        }
      >
        {(user) => (
          <div class="flex items-center gap-3 bg-card border rounded-full pl-2 pr-3 py-1 shadow-sm">
            <img
              src={user().profile_image_url}
              alt={user().display_name}
              class="size-7 rounded-full object-cover border border-primary/30"
            />
            <div class="flex flex-col text-left leading-tight">
              <span class="text-xs font-semibold text-foreground">
                {user().display_name}
              </span>
              <span class="text-[10px] text-muted-foreground">@{user().login}</span>
            </div>
            <button
              onClick={props.onLogout}
              class="ml-1 text-muted-foreground hover:text-destructive transition-colors cursor-pointer p-1 rounded"
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
