import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";
import { Tabs as TabsPrimitive } from "@kobalte/core/tabs";
import { cn } from "~/lib/utils";

export const Tabs = TabsPrimitive;

export const TabsList: Component<ComponentProps<typeof TabsPrimitive.List>> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <TabsPrimitive.List
      class={cn(
        "inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        local.class
      )}
      {...others}
    />
  );
};

export const TabsTrigger: Component<ComponentProps<typeof TabsPrimitive.Trigger>> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <TabsPrimitive.Trigger
      class={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-sm cursor-pointer",
        local.class
      )}
      {...others}
    />
  );
};

export const TabsContent: Component<ComponentProps<typeof TabsPrimitive.Content>> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <TabsPrimitive.Content
      class={cn(
        "mt-3 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        local.class
      )}
      {...others}
    />
  );
};
