// Rebuild Web and installable Web app assets from the single hand-traced SVG. Requires the Sharp
// installation already provided by Next.js; no network or external tools.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (name) => readFile(path.join(root, name), "utf8");
async function save(name, content) {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}
const mark = await read("public/brand/rimiam-mark.svg");
const background = "#F7F8F5";
const icon = mark.replace(
  "</defs>",
  `</defs><rect width="1254" height="1254" fill="${background}"/>`,
);
await save("src/app/icon.svg", icon);
await save(
  "src/app/apple-icon.png",
  await sharp(Buffer.from(icon)).resize(180, 180).flatten().png().toBuffer(),
);
console.log("Generated Web brand assets from rimiam-mark.svg.");
