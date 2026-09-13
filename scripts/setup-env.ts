import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const template = await readFile(".env.example", "utf8");
try {
  await writeFile(
    ".env",
    template.replace(
      "replace-with-a-random-secret-at-least-32-characters",
      randomBytes(32).toString("hex"),
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log("Created .env with a random local authentication secret.");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "EEXIST")
    console.log("Existing .env preserved.");
  else throw error;
}
