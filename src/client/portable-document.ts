import type { ArtifactBlock } from "../contracts/artifact-document";
import { documentMarkdown } from "../shared/document-markdown";
export { documentMarkdown } from "../shared/document-markdown";

export function saveMarkdown(
  title: string,
  version: number,
  body: string,
  blocks?: ArtifactBlock[] | null,
  workspace?: string,
) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob(
      [
        documentMarkdown(
          title,
          body,
          blocks,
          workspace,
          window.location.origin,
        ),
      ],
      {
        type: "text/markdown;charset=utf-8",
      },
    ),
  );
  link.download =
    (title
      .replace(/[^\p{L}\p{N} _.-]+/gu, " ")
      .trim()
      .slice(0, 95) || "Documento") +
    "-v" +
    version +
    ".md";
  document.body.append(link);
  link.click();
  link.remove();
  const url = link.href;
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
