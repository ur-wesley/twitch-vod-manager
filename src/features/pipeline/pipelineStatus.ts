import type { PipelineStage } from "./PipelineMonitor";

export function acceptPipelineProgress(
  activeVodId: string | null,
  eventVodId: string,
): boolean {
  return activeVodId != null && activeVodId === eventVodId;
}

export function showPipelineStatus(
  stage: PipelineStage,
  activeVodId: string | null,
): boolean {
  return stage !== "idle" && activeVodId != null;
}
