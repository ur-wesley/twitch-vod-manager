import type { Component } from "solid-js";
import { cn } from "~/lib/utils";

export interface ProgressProps {
  value: number; // 0 to 100
  class?: string;
  indicatorClass?: string;
}

export const Progress: Component<ProgressProps> = (props) => {
  const percentage = () => Math.min(Math.max(props.value || 0, 0), 100);

  return (
    <div
      class={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary/50", props.class)}
    >
      <div
        class={cn(
          "h-full w-full flex-1 bg-primary transition-all duration-300 ease-out",
          props.indicatorClass,
        )}
        style={{ transform: `translateX(-${100 - percentage()}%)` }}
      />
    </div>
  );
};
