"use client";
import { useUiLanguage } from "./ui-language";
import Image from "next/image";
import { FilePreviewButton } from "./file-preview";
import { isSharedPhoto } from "../shared/photo-media-type";
import type { Snapshot } from "./types";
import styles from "./message-file.module.css";

export function MessageFile({
  workspace,
  source,
}: {
  workspace: string;
  source: Snapshot["sources"][number];
}) {
  const { t: uiText } = useUiLanguage();
  if (source.withdrawn)
    return <small className={styles.excerpt}>{uiText("File ritirato")}</small>;
  const name = source.filename ?? source.title;
  const url = `/api/workspaces/${workspace}/sources/${source.id}`;
  return (
    <div className={styles.file}>
      <FilePreviewButton
        name={name}
        original={url}
        path={`/api/v1/workspaces/${workspace}/source-file?id=${source.id}`}
      >
        {isSharedPhoto(source.media_type) && (
          <Image
            className={styles.photo}
            unoptimized
            src={`${url}?preview=1`}
            width={288}
            height={208}
            alt={name}
          />
        )}
        <span>{name}</span>
      </FilePreviewButton>
      {source.media_type === "text/plain" && source.content && (
        <p className={styles.excerpt}>
          {source.content.length > 220
            ? source.content.slice(0, 220) + "…"
            : source.content}
        </p>
      )}
    </div>
  );
}
