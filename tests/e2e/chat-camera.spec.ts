import { devices, expect, test } from "@playwright/test";
import {
  fillWorkspaceName,
  joinTestWorkspace,
  openMessageComposer,
  register,
} from "./helpers";

const photo = {
  name: "appunto-fotografato.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaPgPAAIDAYAkYfWXAAAAAElFTkSuQmCC",
    "base64",
  ),
};

test("a member can cancel the camera, preview a shot and explicitly share it once with the group", async ({
  browser,
}, info) => {
  test.setTimeout(95000);
  const phone = await browser.newContext(devices["iPhone 13 Pro"]);
  const member = await phone.newPage();
  const other = await browser.newPage();
  try {
    const workspace = "Appunti fotografici";
    await register(
      member,
      "Elena",
      `camera-${crypto.randomUUID()}@example.test`,
    );
    await fillWorkspaceName(member, workspace);
    await member
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      member.getByRole("heading", { name: workspace, exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(member, other, workspace, "Davide");
    const composer = await openMessageComposer(member);
    await composer.tap();
    const caption = "Il punto di accesso da controllare.";
    await composer.fill(caption);
    const camera = member.getByRole("button", { name: "Scatta una foto" });
    const send = member.getByRole("button", { name: "Invia", exact: true });
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [844, 390],
    ]) {
      await member.setViewportSize({ width, height });
      await expect(camera).toBeInViewport({ ratio: 1 });
      const area = (await composer.boundingBox())!;
      const row = (await member.locator(".composer-row").boundingBox())!;
      expect(area.width).toBeGreaterThanOrEqual(row.width - 2);
      const actions = member.locator(".composer-row button:visible");
      const boxes = (
        await actions.evaluateAll((elements) =>
          elements.map((e) => {
            const b = e.getBoundingClientRect();
            return { x: b.x, y: b.y, right: b.right, bottom: b.bottom };
          }),
        )
      ).sort((a, b) => a.x - b.x);
      for (const [index, button] of boxes.entries()) {
        expect(button.y).toBeGreaterThanOrEqual(area.y + area.height - 1);
        expect(button.x).toBeGreaterThanOrEqual(0);
        expect(button.right).toBeLessThanOrEqual(width + 1);
        if (index > 0 && Math.abs(boxes[index - 1].y - button.y) < 3)
          expect(button.x).toBeGreaterThanOrEqual(boxes[index - 1].right - 1);
      }
      await expect(send).toBeInViewport({ ratio: 1 });
    }
    await member.setViewportSize({ width: 390, height: 844 });
    const queue = member.getByRole("list", {
      name: "Allegati in ordine di invio",
    });
    const submitted: Array<
      { filename: string; allowModelProcessing?: boolean }[]
    > = [];
    member.on("request", (request) => {
      if (request.method() !== "POST" || !request.url().endsWith("/commands"))
        return;
      const command = request.postDataJSON()?.command;
      if (command?.type === "message.send")
        submitted.push(command.attachments ?? []);
    });
    const [cancelled] = await Promise.all([
      member.waitForEvent("filechooser"),
      camera.tap(),
    ]);
    expect(await cancelled.element().getAttribute("capture")).toBe(
      "environment",
    );
    expect(await cancelled.element().getAttribute("accept")).toBe("image/*");
    expect(cancelled.isMultiple()).toBe(false);
    await cancelled.setFiles([]);
    await expect(queue).toHaveCount(0);
    await expect(composer).toHaveValue(caption);
    await composer.tap();
    const [captured] = await Promise.all([
      member.waitForEvent("filechooser"),
      camera.tap(),
    ]);
    await captured.setFiles(photo);
    const preview = queue.locator("img");
    await expect(preview).toBeVisible();
    await expect
      .poll(() =>
        preview.evaluate(
          (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(
      queue.getByRole("checkbox", { name: /Consenti lettura AI/ }),
    ).not.toBeChecked();
    await expect(composer).toHaveValue(caption);
    const received = other
      .locator(".messages")
      .getByRole("article", { name: "Elena", exact: true })
      .filter({ hasText: photo.name });
    await expect(received).toHaveCount(0);
    expect(submitted).toEqual([]);
    await member.screenshot({
      path: info.outputPath("camera-preview-390.png"),
    });
    await send.tap();
    await expect(received).toHaveCount(1);
    await expect(received).toContainText(caption);
    await expect(received.getByRole("img", { name: photo.name })).toBeVisible();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toHaveLength(1);
    expect(submitted[0][0].filename).toBe(photo.name);
    expect(submitted[0][0].allowModelProcessing).toBeUndefined();
    const workspaceId = new URL(other.url()).searchParams.get("workspace");
    await expect
      .poll(async () => {
        const result = await other.request.get(
          `/api/workspaces/${workspaceId}`,
        );
        expect(result.ok()).toBe(true);
        const snapshot: {
          sources: {
            filename: string | null;
            processing_status: string;
            processing_error: string | null;
            content: string;
          }[];
        } = await result.json();
        const image = snapshot.sources.find(
          (source) => source.filename === photo.name,
        );
        return [
          image?.processing_status,
          image?.processing_error,
          image?.content,
        ];
      })
      .toEqual(["needs_input", "MEDIA_DISCLOSURE_REQUIRED", ""]);
    await expect(queue).toHaveCount(0);
    await other.reload();
    await expect(received).toHaveCount(1);
  } finally {
    await phone.close();
    await other.close();
  }
});
