import { describe, expect, it } from "vitest";
import { formatSecondsToTimestamp, parseTimestampToSeconds } from "./utils";

describe("utils timestamp helpers", () => {
  describe("parseTimestampToSeconds", () => {
    it("parses pure minute strings with default unit", () => {
      expect(parseTimestampToSeconds("15")).toBe(900);
      expect(parseTimestampToSeconds("0")).toBe(0);
      expect(parseTimestampToSeconds("1.5")).toBe(90);
    });

    it("parses pure seconds when default unit is seconds", () => {
      expect(parseTimestampToSeconds("90", "seconds")).toBe(90);
    });

    it("parses mm:ss timestamps", () => {
      expect(parseTimestampToSeconds("15:30")).toBe(930);
      expect(parseTimestampToSeconds("0:45")).toBe(45);
      expect(parseTimestampToSeconds("00:00")).toBe(0);
    });

    it("parses hh:mm:ss timestamps", () => {
      expect(parseTimestampToSeconds("01:15:30")).toBe(4530);
      expect(parseTimestampToSeconds("2:00:00")).toBe(7200);
    });

    it("parses shorthand strings like 15m, 1h20m, 45s", () => {
      expect(parseTimestampToSeconds("15m")).toBe(900);
      expect(parseTimestampToSeconds("1h 15m 30s")).toBe(4530);
      expect(parseTimestampToSeconds("45s")).toBe(45);
    });

    it("handles invalid inputs gracefully", () => {
      expect(parseTimestampToSeconds("")).toBeNull();
      expect(parseTimestampToSeconds("abc")).toBeNull();
      expect(parseTimestampToSeconds("-5")).toBeNull();
      expect(parseTimestampToSeconds(undefined)).toBeNull();
      expect(parseTimestampToSeconds(null)).toBeNull();
    });
  });

  describe("formatSecondsToTimestamp", () => {
    it("formats minutes and seconds", () => {
      expect(formatSecondsToTimestamp(0)).toBe("00:00");
      expect(formatSecondsToTimestamp(45)).toBe("00:45");
      expect(formatSecondsToTimestamp(930)).toBe("15:30");
    });

    it("formats hours, minutes, and seconds", () => {
      expect(formatSecondsToTimestamp(3600)).toBe("01:00:00");
      expect(formatSecondsToTimestamp(4530)).toBe("01:15:30");
    });

    it("respects forceHours", () => {
      expect(formatSecondsToTimestamp(930, true)).toBe("00:15:30");
    });
  });
});
