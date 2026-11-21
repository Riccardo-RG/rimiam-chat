import { describe, expect, it } from "vitest";
import {
  currentRecordingConsentText,
  recordingConsentText,
  recordingConsentWordingSchema,
} from "../src/contracts/calls";
import { translateUi } from "../src/shared/i18n";
import { libraryPeriods, libraryTabs } from "../src/shared/library-view";
import { workspaceGuideTopics } from "../src/shared/workspace-guide-topics";

describe("workspace tool language", () => {
  it("translates library filters without altering their IDs or the name of the original", () => {
    expect(libraryTabs.map((tab) => translateUi("en", tab))).toEqual([
      "Recent",
      "Files",
      "Media",
      "Links",
      "Favorites",
    ]);
    expect(translateUi("en", libraryPeriods.week)).toBe("Last 7 days");
    expect(translateUi("en", "Apri {0}", "Aggiungi link")).toBe(
      "Open Aggiungi link",
    );
    expect(libraryTabs[1]).toBe("File");
  });

  it("gives every guide topic a distinct English heading and explanation", () => {
    for (const [heading, body] of workspaceGuideTopics) {
      expect(translateUi("it", body)).toBe(body);
      expect(translateUi("en", heading)).not.toBe(heading);
      expect(translateUi("en", body)).not.toBe(body);
    }
  });

  it.each([currentRecordingConsentText, recordingConsentText])(
    "explains the scope of recording consent and preserves the canonical command wording",
    (original) => {
      const english = translateUi("en", original);
      expect(english).toContain("recording my audio, transcribing it");
      expect(english).toContain("shared workspace source");
      expect(english).toContain("members who join later");
      expect(english).toContain(
        "does not delete previously authorized material",
      );
      expect(english).toContain("requires a separate request");
      expect(recordingConsentWordingSchema.safeParse(original).success).toBe(
        true,
      );
      expect(recordingConsentWordingSchema.safeParse(english).success).toBe(
        false,
      );
    },
  );
});
