import type { Snapshot } from "../contracts/web-snapshot.ts";
import {
  currentSharedFiles,
  sharedFileType,
  isSharedPhoto,
  sharedPages,
  sharedConversationLinks,
} from "./file-library.ts";

export const libraryTabs = [
  "Recenti",
  "File",
  "Media",
  "Collegamenti",
  "Preferiti",
] as const;
export type LibraryTab = (typeof libraryTabs)[number];
export const libraryPeriods = {
  all: "Tutto il periodo",
  week: "Ultimi 7 giorni",
  month: "Ultimi 30 giorni",
  range: "Scegli intervallo",
} as const;
export function libraryDay(value: string | Date) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function shortPageLabel(address: string) {
  const { hostname, pathname } = new URL(address);
  const segments = pathname.split("/").filter(Boolean);
  const last = segments.at(-1);
  if (!last) return hostname;
  let segment = last;
  try {
    segment = decodeURIComponent(last);
  } catch {
    // Keep a malformed encoded path readable without changing its destination.
  }
  const letters = Array.from(
    segment.replace(
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
      "",
    ),
  );
  const abbreviated =
    letters.length > 36
      ? letters.slice(0, 35).join("") + "…"
      : letters.join("");
  return hostname + (segments.length > 1 ? "/…/" : "/") + abbreviated;
}

export function fileReading(file: Snapshot["sources"][number]) {
  if (file.withdrawn) return "File ritirato";
  if (file.processing_error === "MEDIA_DISCLOSURE_REQUIRED")
    return "Lettura con AI non autorizzata.";
  switch (file.processing_status) {
    case "ready":
      return null;
    case "queued":
      return "Lettura in attesa";
    case "processing":
      return "Lettura in corso";
    case "needs_configuration":
      return "Servizio di lettura da collegare";
    case "needs_input":
      return "Serve un chiarimento o un formato leggibile";
    case "failed":
      return "Lettura non riuscita";
    case null:
    case undefined:
      return file.content?.trim() ? null : "Stato della lettura da verificare.";
    default:
      return "Stato della lettura da verificare.";
  }
}

export function libraryView(
  state: Pick<Snapshot, "sources" | "messages">,
  {
    tab,
    term,
    type,
    period,
    day,
    until,
    personal,
  }: {
    tab: LibraryTab;
    term: string;
    type: string;
    period: string;
    day: string;
    until: string;
    personal?: boolean;
  },
  now = new Date(),
) {
  const recentBoundary = new Date(now);
  recentBoundary.setDate(
    recentBoundary.getDate() - (period === "week" ? 6 : 29),
  );
  function dateMatches(value: string) {
    const when = libraryDay(value);
    if (period === "range")
      return (!day || when >= day) && (!until || when <= until);
    return period === "all" || when >= libraryDay(recentBoundary);
  }
  const query = term.trim().toLocaleLowerCase("it");
  const messagesById = new Map(state.messages.map((m) => [m.id, m]));
  // Pick the most recent occurrence *within* the selected period. A page
  // shared again today must still be discoverable on its earlier date.
  const messagesInPeriod =
    period === "all"
      ? state.messages
      : state.messages.filter((message) => dateMatches(message.created_at));
  const pages = sharedPages(messagesInPeriod).map((p) => ({
    id: p.id,
    title: shortPageLabel(p.href),
    url: p.href,
  }));
  const mentions = sharedConversationLinks(messagesInPeriod).map((p) => ({
    id: p.messages[0].id,
    title: p.host,
    url: null,
  }));
  const links =
    (tab === "Recenti" || tab === "Collegamenti") &&
    (!type || type === "Collegamento")
      ? [...pages, ...mentions].filter(
          (link) =>
            !query ||
            link.title.toLocaleLowerCase("it").includes(query) ||
            link.url?.toLocaleLowerCase("it").includes(query),
        )
      : [];
  const all = currentSharedFiles(state.sources).filter(
    (file) => !file.withdrawn,
  );
  const emptySharedLibrary =
    !personal &&
    tab === "Recenti" &&
    !all.length &&
    !pages.length &&
    !mentions.length &&
    !query &&
    !type &&
    period === "all";
  const matches = all.filter((file) => {
    const filename = file.filename ?? file.title;
    return (
      tab !== "Collegamenti" &&
      (tab !== "Media" || isSharedPhoto(file.media_type)) &&
      (tab !== "Preferiti" || file.favorite) &&
      dateMatches(file.created_at) &&
      (!type || sharedFileType(file.media_type, filename) === type) &&
      (!term ||
        filename
          .toLocaleLowerCase("it")
          .includes(term.trim().toLocaleLowerCase("it")))
    );
  });
  const list = [
    ...matches.map((file) => ({ file, link: null, date: file.created_at })),
    ...links.map((link) => ({
      file: null,
      link,
      date: messagesById.get(link.id)!.created_at,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return { list, messagesById, links, all, emptySharedLibrary };
}

export type LibraryEntry = ReturnType<typeof libraryView>["list"][number];

export function libraryEntryKey(entry: LibraryEntry) {
  if (entry.file) return "file:" + (entry.file.document_id ?? entry.file.id);
  if (!entry.link) throw new Error("INVALID_LIBRARY_ENTRY");
  // A single ordinary message may contain several hostnames.
  return (
    "link:" + entry.link.id + ":" + (entry.link.url ? "page" : entry.link.title)
  );
}
