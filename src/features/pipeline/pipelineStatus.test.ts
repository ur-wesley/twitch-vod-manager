import { describe, expect, it } from "vitest";
import { acceptPipelineProgress, showPipelineStatus } from "./pipelineStatus";

describe("acceptPipelineProgress", () => {
  it("accepts when activeVodId matches eventVodId", () => {
    expect(acceptPipelineProgress("12345", "12345")).toBe(true);
  });

  it("rejects when activeVodId is null", () => {
    expect(acceptPipelineProgress(null, "12345")).toBe(false);
  });

  it("rejects when ids mismatch", () => {
    expect(acceptPipelineProgress("12345", "99999")).toBe(false);
  });
});

describe("showPipelineStatus", () => {
  it("shows when stage is active and vod id is set", () => {
    expect(showPipelineStatus("downloading", "12345")).toBe(true);
    expect(showPipelineStatus("completed", "12345")).toBe(true);
  });

  it("hides when stage is idle", () => {
    expect(showPipelineStatus("idle", "12345")).toBe(false);
  });

  it("hides when vod id is null even if stage is completed", () => {
    expect(showPipelineStatus("completed", null)).toBe(false);
    expect(showPipelineStatus("uploading", null)).toBe(false);
  });
});
