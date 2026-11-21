import { describe, expect, it } from "vitest";
import { createFileUploadCommand } from "../src/client/file-upload";

describe("Web file upload envelopes", () => {
  it("preserves original note bytes across chunks and scopes the share to the chosen filone", async () => {
    const text = "È una nota 📝\n".repeat(800);
    const focus = { workstreamId: crypto.randomUUID(), version: 3 };
    const { command } = await createFileUploadCommand(
      "actor",
      "workspace",
      new File([text], "nota.txt"),
      {
        allowModelProcessing: true,
        conversationShare: { workstreamFocus: focus },
      },
    );
    expect(Buffer.from(command.bytesBase64, "base64").toString("utf8")).toBe(
      text,
    );
    expect(command.conversationShare).toEqual({ workstreamFocus: focus });
    expect(command).not.toHaveProperty("allowModelProcessing");
  });

  it("only includes consent for media upon an explicit opt-in; collection uploads stay in the collection", async () => {
    const file = new File([new Uint8Array([255, 216, 255])], "scatto.JPEG");
    const { command } = await createFileUploadCommand(
      "actor",
      "workspace",
      file,
    );
    expect(command).not.toHaveProperty("allowModelProcessing");
    expect(command).not.toHaveProperty("conversationShare");
    const optedIn = await createFileUploadCommand("actor", "workspace", file, {
      allowModelProcessing: true,
      conversationShare: {},
    });
    expect(optedIn.command.allowModelProcessing).toBe(true);
    expect(optedIn.command.conversationShare).toEqual({});
  });

  it("rejects an unsupported photo and oversized text before creating an upload", async () => {
    await expect(
      createFileUploadCommand(
        "actor",
        "workspace",
        new File(["x"], "scatto.heic"),
      ),
    ).rejects.toThrow("DOCUMENT_FORMAT_UNSUPPORTED");
    await expect(
      createFileUploadCommand(
        "actor",
        "workspace",
        new File([new Uint8Array(1048577)], "lungo.txt"),
      ),
    ).rejects.toThrow("1 MiB");
  });
});
