import type { Component, ComponentProps, JSX } from "solid-js";
import { splitProps } from "solid-js";
import { Dialog as DialogPrimitive } from "@kobalte/core/dialog";
import { cn } from "~/lib/utils";

export const Dialog = DialogPrimitive;
export const DialogTrigger = DialogPrimitive.Trigger;

export const DialogPortal: Component<
  ComponentProps<typeof DialogPrimitive.Portal> & { children: JSX.Element }
> = (props) => {
  return (
    <DialogPrimitive.Portal>
      <div class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto">
        {props.children}
      </div>
    </DialogPrimitive.Portal>
  );
};

export const DialogOverlay: Component<ComponentProps<typeof DialogPrimitive.Overlay>> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <DialogPrimitive.Overlay
      class={cn(
        "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
        local.class,
      )}
      {...others}
    />
  );
};

export const DialogContent: Component<ComponentProps<typeof DialogPrimitive.Content>> = (props) => {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        class={cn(
          "relative z-50 grid w-full max-w-lg gap-4 border bg-background p-6 shadow-2xl rounded-2xl duration-200 sm:rounded-2xl",
          local.class,
        )}
        {...others}
      >
        {local.children}
        <DialogPrimitive.CloseButton class="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none cursor-pointer">
          <span class="i-mdi-close size-4" aria-hidden="true" />
          <span class="sr-only">Close</span>
        </DialogPrimitive.CloseButton>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
};

export const DialogHeader: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("flex flex-col space-y-1.5 text-center sm:text-left", local.class)}
      {...others}
    />
  );
};

export const DialogTitle: Component<ComponentProps<typeof DialogPrimitive.Title>> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <DialogPrimitive.Title
      class={cn("text-lg font-semibold leading-none tracking-tight", local.class)}
      {...others}
    />
  );
};

export const DialogDescription: Component<ComponentProps<typeof DialogPrimitive.Description>> = (
  props,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <DialogPrimitive.Description
      class={cn("text-sm text-muted-foreground", local.class)}
      {...others}
    />
  );
};

export const DialogFooter: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 gap-2", local.class)}
      {...others}
    />
  );
};
