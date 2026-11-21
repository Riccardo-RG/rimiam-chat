import type { ArtifactBlock } from "../contracts/artifact-document";

export function documentMarkdown(
  title: string,
  body: string,
  blocks?: ArtifactBlock[] | null,
  workspace?: string,
  origin?: string,
) {
  const cell = (value: string) =>
    value.replaceAll("|", "\\|").replaceAll("\n", " ");
  const content =
    blocks
      ?.map((b) => {
        switch (b.type) {
          case "heading":
            return "## " + b.text;
          case "paragraph":
            return b.text;
          case "checklist":
            return b.items
              .map((i) => "- [" + (i.checked ? "x" : " ") + "] " + i.text)
              .join("\n");
          case "image": {
            const link = workspace
              ? "/api/workspaces/" +
                encodeURIComponent(workspace) +
                "/sources/" +
                encodeURIComponent(b.sourceId)
              : "";
            const absolute = link && origin ? new URL(link, origin).href : link;
            return [
              absolute
                ? "[" + b.alt.replaceAll("]", "\\]") + "](" + absolute + ")"
                : b.alt,
              b.caption,
            ]
              .filter(Boolean)
              .join(" — ");
          }
          case "table":
            return [
              b.columns.map(cell),
              b.columns.map(() => "---"),
              ...b.rows.map((r) => r.map(cell)),
            ]
              .map((row) => "| " + row.join(" | ") + " |")
              .join("\n");
        }
      })
      .join("\n\n") ?? body;
  return "# " + title + "\n\n" + content + "\n";
}
