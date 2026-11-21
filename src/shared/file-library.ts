import type { Snapshot } from "../contracts/web-snapshot.ts";

type FileIndexEntry = Pick<
  Snapshot["sources"][number],
  "kind" | "id" | "document_id" | "document_version" | "created_at"
>;

// Each retained document version has its own Source ID. The library shows one
// current entry per document identity, even when a later upload renames it.
export function currentSharedFiles<T extends FileIndexEntry>(
  sources: readonly T[],
): T[] {
  const files = new Map<string, T>();
  for (const source of sources) {
    if (source.kind !== "document") continue;
    const key = source.document_id ?? source.id;
    const prior = files.get(key);
    if (
      !prior ||
      (source.document_version ?? 1) > (prior.document_version ?? 1)
    )
      files.set(key, source);
  }
  return [...files.values()].sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
  );
}

export function sharedFileType(
  media: string | null | undefined,
  filename: string,
) {
  const extension = filename.toLowerCase().split(".").pop();
  if (media?.startsWith("image/") || /^(png|jpe?g|webp)$/.test(extension ?? ""))
    return "Immagine";
  if (
    media?.startsWith("audio/") ||
    /^(mp3|m4a|wav|webm|ogg)$/.test(extension ?? "")
  )
    return "Audio";
  if (media === "application/pdf" || extension === "pdf") return "PDF";
  if (extension === "docx") return "Word";
  if (extension === "csv") return "Tabella";
  if (extension === "md") return "Markdown";
  if (media?.startsWith("text/") || extension === "txt") return "Testo";
  return "File";
}

export { isSharedPhoto } from "./photo-media-type.ts";

export function noteFilename(body: string) {
  // Name the file without changing the shared text. Exclude filesystem and
  // invisible formatting characters from the proposed display/download name.
  const firstLine = body.split(/\r\n?|\n/u).find((line) => line.trim()) ?? "";
  const safe = firstLine
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M} _-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return `${Array.from(safe).slice(0, 56).join("").trim() || "Nota"}.txt`;
}

type LibraryMessage = Pick<
  Snapshot["messages"][number],
  "id" | "content" | "purpose" | "author_id" | "actor_kind" | "sequence"
>;

function publicPage(raw: string): URL | undefined {
  try {
    if (!/^https?:\/\//i.test(raw) || /[\s\\<>"`]/u.test(raw)) return;
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.username || url.password || !/^[a-z\d.-]+\.[a-z]{2,}$/i.test(host))
      return;
    if (/(?:^|\.)(?:localhost|local|internal|lan|onion)$/.test(host)) return;
    const target = decodeURIComponent(url.pathname + url.search + url.hash);
    // An overview should not resurface account links, signed URLs, personal
    // addresses or telephone numbers. The author's message remains the source.
    if (
      /@|(?:^|[^\d])\+?\d[\d ().-]{6,}\d(?:[^\d]|$)/.test(target) ||
      /(?:^|[^a-z])(?:invite|invitation|join|reset|verify|verification|oauth|auth|session|token|secret|sig|signature|credential|password|code|email|phone|key|apikey|jwt|nonce)(?:[^a-z]|$)/i.test(
        target,
      ) ||
      /^(?:chat\.whatsapp\.com|wa\.me|discord\.gg|join\.slack\.com)$/.test(host)
    )
      return;
    return url;
  } catch {
    return;
  }
}

// Explicitly shared pages are ordinary attributed chat messages. The marker
// only affects their presentation in the library, never permissions or state.
const sharedPagePrefix = "Pagina condivisa: ";
const savedPagePrefix = "Pagina salvata: ";
export function pageMessage(address: string, personal = false) {
  const url = publicPage(address.trim());
  const prefix = personal ? savedPagePrefix : sharedPagePrefix;
  if (!url || url.href.length + prefix.length > 12000) return;
  return prefix + url.href;
}

function explicitPage(message: LibraryMessage) {
  if (
    message.actor_kind !== "human" ||
    !message.author_id ||
    message.purpose !== "conversation"
  )
    return;
  const prefix = [sharedPagePrefix, savedPagePrefix].find((start) =>
    message.content.startsWith(start),
  );
  return prefix ? publicPage(message.content.slice(prefix.length)) : undefined;
}

export function sharedPages(messages: readonly LibraryMessage[]) {
  const pages = new Map<
    string,
    { href: string; id: string; sequence: number }
  >();
  for (const message of messages) {
    const page = explicitPage(message);
    if (!page) continue;
    const prior = pages.get(page.href);
    if (!prior || prior.sequence < message.sequence)
      pages.set(page.href, {
        href: page.href,
        id: message.id,
        sequence: message.sequence,
      });
  }
  return [...pages.values()].sort((a, b) => b.sequence - a.sequence);
}

// Return only hostnames and message references. No outgoing links or previews:
// the original message keeps the exact URL in its original shared context.
export function sharedConversationLinks(messages: readonly LibraryMessage[]) {
  const grouped = new Map<string, { id: string; sequence: number }[]>();
  for (const message of messages) {
    if (
      !message.author_id ||
      message.actor_kind !== "human" ||
      message.purpose === "workspace_welcome" ||
      explicitPage(message)
    )
      continue;
    const found = new Set<string>();
    for (const match of message.content.matchAll(
      /\bhttps?:\/\/[^\s<>"'`]+/gi,
    )) {
      const host = publicPage(match[0].replace(/[),.;!?\]}]+$/u, ""))
        ?.hostname.toLowerCase()
        .replace(/\.$/, "");
      if (!host || found.has(host)) continue;
      found.add(host);
      const references = grouped.get(host) ?? [];
      references.push({ id: message.id, sequence: message.sequence });
      grouped.set(host, references);
    }
  }
  return [...grouped]
    .map(([host, references]) => ({
      host,
      messages: references.sort((a, b) => b.sequence - a.sequence),
    }))
    .sort(
      (a, b) =>
        b.messages[0].sequence - a.messages[0].sequence ||
        a.host.localeCompare(b.host),
    );
}
