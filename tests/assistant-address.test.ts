import { describe, expect, it } from "vitest";
import {
  addressMiriam,
  isAssistantAddress,
  potentiallyHumanAddress,
  withoutAssistantAddress,
  isSourceQuestion,
} from "../src/shared/miriam-address";
import { requestedWorkstreamTitle } from "../src/shared/workstream-intent";
import { startObjective } from "../src/server/active-work-commands";
import { parseReminderRequest } from "../src/server/conversation-reminder";

describe("custom conversational address", () => {
  it("recognizes exact Unicode and multi-word names without matching partial names or similar punctuation", () => {
    expect(isAssistantAddress("Ciao, @Émilie S., ciao", "Émilie S.")).toBe(
      true,
    );
    expect(isAssistantAddress("@Émilie Sx ciao", "Émilie S.")).toBe(false);
    expect(isAssistantAddress("@Émilienne ciao", "Émilie")).toBe(false);
    expect(withoutAssistantAddress("@José, ciao", "José")).toBe("ciao");
    expect(
      isSourceQuestion("@José, spiega il confronto", "source", true, "José"),
    ).toBe(true);
    expect(isAssistantAddress("@Emme, ciao", "José")).toBe(true);
    expect(potentiallyHumanAddress("@emme dimmi", "José")).toBeUndefined();
    expect(potentiallyHumanAddress("Ciao @José Ale, dimmi", "José Ale")).toBe(
      "josé ale",
    );
    expect(addressMiriam("@José che ne pensi?")).toBe(
      "@Emme @José che ne pensi?",
    );
  });
  it("uses the selected alias consistently for deterministic commands", () => {
    expect(
      requestedWorkstreamTitle(
        "Ciao @Rina, apri un argomento su interviste",
        "Rina",
      ),
    ).toBe("interviste");
    expect(startObjective("@Rina, analizza: la beta", "Rina")).toBe("la beta");
    expect(
      parseReminderRequest(
        "@Rina, ricordaci domani alle 10 di chiamare",
        false,
        "Rina",
      ),
    ).toMatchObject({ audience: "space", content: "chiamare", hour: 10 });
    expect(
      parseReminderRequest(
        "@Rita, ricordaci domani alle 10 di chiamare",
        false,
        "Rina",
      ),
    ).toBeNull();
  });
});
