import { test, expect } from "@playwright/test";
import { openWorkspaceCreation, register } from "./helpers";

test("a temporary journal read failure blocks creation, preserves drafts and recovers without a duplicate request", async ({
  page,
}) => {
  const suffix = crypto.randomUUID();
  const name = `Storage recovery ${suffix}`;
  const description =
    "Questa introduzione deve restare disponibile dopo il recupero dei promemoria.";
  await register(page, "Storage recovery", `storage-${suffix}@example.test`);
  const workspaceName = await openWorkspaceCreation(page);
  const workspaceDescription = page.getByLabel(
    "Da dove partite? (facoltativo)",
    {
      exact: true,
    },
  );
  const create = page.getByRole("button", { name: "Crea spazio", exact: true });
  const pending = page.getByRole("region", {
    name: "Operazioni da verificare",
    exact: true,
  });
  const creationRequests: unknown[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/workspaces"
    )
      creationRequests.push(request.postDataJSON());
  });
  await expect(create).toBeEnabled();
  await workspaceName.fill(name);
  await workspaceDescription.fill(description);

  await page.evaluate(() => {
    const originalOpen = indexedDB.open;
    const browser = window as Window & {
      __rimiamRestoreIndexedDbOpen?: () => void;
    };
    browser.__rimiamRestoreIndexedDbOpen = () => {
      indexedDB.open = originalOpen;
      delete browser.__rimiamRestoreIndexedDbOpen;
    };
    indexedDB.open = () => {
      throw new DOMException(
        "Simulated local storage failure",
        "InvalidStateError",
      );
    };
    window.dispatchEvent(new Event("miriam-pending-commands"));
  });

  try {
    await expect(create).toBeDisabled();
    await expect(pending).toBeVisible();
    await expect(pending.getByRole("status")).toContainText(
      "Una richiesta già inviata potrebbe essere stata completata.",
    );
    const creationStorageError = page.getByRole("alert").filter({
      hasText: "Ricaricale prima di creare uno spazio.",
    });
    await expect(creationStorageError).toBeVisible();
    await expect(workspaceName).toHaveValue(name);
    await expect(workspaceDescription).toHaveValue(description);
    await workspaceName.press("Enter");
    expect(creationRequests).toHaveLength(0);
    await expect(workspaceName).toHaveValue(name);
    await expect(workspaceDescription).toHaveValue(description);

    await page.evaluate(() => {
      (
        window as Window & { __rimiamRestoreIndexedDbOpen?: () => void }
      ).__rimiamRestoreIndexedDbOpen?.();
    });
    await page
      .getByRole("button", {
        name: "Ricarica le richieste salvate",
        exact: true,
      })
      .click();
    await expect(create).toBeEnabled();
    await expect(creationStorageError).not.toBeVisible();
    await expect(pending).not.toBeVisible();
    await expect(workspaceName).toHaveValue(name);
    await expect(workspaceDescription).toHaveValue(description);
    expect(creationRequests).toHaveLength(0);

    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/workspaces",
    );
    await create.click();
    expect((await created).ok()).toBe(true);
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    expect(creationRequests).toHaveLength(1);
    expect(creationRequests[0]).toMatchObject({ name, description });
  } finally {
    await page.evaluate(() => {
      (
        window as Window & { __rimiamRestoreIndexedDbOpen?: () => void }
      ).__rimiamRestoreIndexedDbOpen?.();
    });
  }
});
