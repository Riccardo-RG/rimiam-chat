import { expect, it } from "vitest";
import {
  fileReading,
  shortPageLabel,
  libraryEntryKey,
  libraryView,
  type LibraryTab,
} from "../src/shared/library-view";
import type { Snapshot } from "../src/contracts/web-snapshot";
import {
  currentSharedFiles,
  isSharedPhoto,
  noteFilename,
  pageMessage,
  sharedPages,
  sharedConversationLinks,
  sharedFileType,
} from "../src/client/shared-file-library";

it("shows the same chronological library, filters and personal favorites on Web and native", () => {
  const image: Snapshot["sources"][number] = {
    id: "photo",
    kind: "document",
    title: "Schermata",
    filename: "schermata.png",
    media_type: "image/png",
    content: "",
    contributed_by: "ada",
    qualification: "source",
    content_hash: "hash",
    created_at: "2026-11-14T12:00:00Z",
    document_id: "doc1",
    document_version: 1,
    previous_source_id: null,
    url: null,
    provider: null,
    work_id: null,
    favorite: true,
  };
  expect(fileReading({ ...image, processing_status: "queued" })).toBe(
    "Lettura in attesa",
  );
  expect(
    fileReading({
      ...image,
      processing_status: "needs_input",
      processing_error: "MEDIA_DISCLOSURE_REQUIRED",
    }),
  ).toBe("Lettura con AI non autorizzata.");
  expect(
    fileReading({ ...image, withdrawn: true, processing_status: "ready" }),
  ).toBe("File ritirato");
  expect(fileReading({ ...image, processing_status: "ready" })).toBeNull();
  const link: Snapshot["messages"][number] = {
    id: "link",
    content: "Vedi https://rimiam.example/guida",
    author_id: "ada",
    author_name: "Ada",
    actor_kind: "human",
    purpose: "conversation",
    citation_source_ids: [],
    reply_to_source_id: null,
    workstream_focus: null,
    reference: null,
    created_at: "2026-11-19T12:00:00Z",
    sequence: 2,
  };
  const state = {
    sources: [
      image,
      {
        ...image,
        id: "sound",
        document_id: "doc2",
        filename: "voce.m4a",
        media_type: "audio/mp4",
        favorite: false,
        created_at: "2026-11-13T12:00:00Z",
      },
      { ...image, id: "removed", document_id: "doc3", withdrawn: true },
    ],
    messages: [link],
  };
  const rows = (tab: LibraryTab, period = "all", day = "", until = "") =>
    libraryView(
      state,
      { tab, term: "", type: "", period, day, until },
      new Date("2026-11-20T12:00:00Z"),
    ).list.map((row) => row.file?.id ?? row.link?.id);
  const matching = (messages: typeof state.messages) =>
    libraryView(
      { ...state, messages },
      { tab: "Recenti", term: "", type: "", period: "all", day: "", until: "" },
    ).list.map(libraryEntryKey);
  expect(
    matching([
      {
        ...link,
        content:
          "Leggi https://one.example/path-a e https://two.example/path-b",
      },
    ]),
  ).toEqual([
    "link:link:one.example",
    "link:link:two.example",
    "file:doc1",
    "file:doc2",
  ]);
  expect(
    matching([
      { ...link, content: "Pagina condivisa: https://one.example/path-a" },
    ])[0],
  ).toBe("link:link:page");
  expect(rows("Recenti")).toEqual(["link", "photo", "sound"]);
  expect(rows("Media")).toEqual(["photo"]);
  expect(rows("Preferiti")).toEqual(["photo"]);
  expect(rows("Recenti", "week")).toEqual(["link", "photo"]);
  expect(rows("File", "range", "2026-11-13", "2026-11-14")).toEqual([
    "photo",
    "sound",
  ]);
  expect(rows("Collegamenti")).toEqual(["link"]);
  const older = {
    ...link,
    id: "earlier-link",
    sequence: 1,
    created_at: "2026-10-03T12:00:00Z",
  };
  for (const content of [
    link.content,
    "Pagina condivisa: https://rimiam.example/guida",
  ]) {
    const matches = libraryView(
      {
        sources: [],
        messages: [
          { ...older, content },
          { ...link, content },
        ],
      },
      {
        tab: "Collegamenti",
        term: "rimiam",
        type: "Collegamento",
        period: "range",
        day: "2026-10-03",
        until: "2026-10-03",
      },
    );
    expect(matches.list.map((row) => row.link?.id)).toEqual(["earlier-link"]);
  }
});

it("previews only supported raster media typed by the server", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp"])
    expect(isSharedPhoto(type)).toBe(true);
  for (const type of [
    "image/svg+xml",
    "image/gif",
    "text/html",
    null,
    undefined,
  ])
    expect(isSharedPhoto(type)).toBe(false);
});

it("names free text notes from their first written line without changing their content", () => {
  const body = "\n\n Appunti / di: oggi! \r\nPrezzo: €80\n";
  expect(noteFilename(body)).toBe("Appunti di oggi.txt");
  expect(noteFilename("../\\:\u202e \r\nvalid")).toBe("Nota.txt");
  expect(noteFilename("e\u0300 in arrivo")).toBe("è in arrivo.txt");
  expect(noteFilename("a".repeat(2000))).toBe("a".repeat(56) + ".txt");
});

it("lists the latest retained file of each document and excludes web research when building the file collection", () => {
  const file = {
    id: "s1",
    kind: "document" as const,
    document_id: "d1",
    document_version: 1,
    created_at: "2026-11-01",
  };
  const latest = {
    ...file,
    id: "s2",
    document_version: 2,
    created_at: "2026-11-12",
  };
  const audio = {
    ...file,
    id: "s3",
    document_id: "d2",
    created_at: "2026-11-14",
  };
  const web = { ...file, id: "s4", kind: "web" as const, document_id: null };
  expect(currentSharedFiles([latest, web, file, audio])).toEqual([
    audio,
    latest,
  ]);
  expect(sharedFileType("audio/mp4", "voce.m4a")).toBe("Audio");
  expect(sharedFileType(undefined, "contratto.PDF")).toBe("PDF");
  expect(sharedFileType("image/webp", "condivisione")).toBe("Immagine");
});

it("groups links actually shared by humans and exposes only hostnames and exact message references", () => {
  const message = {
    id: "m1",
    sequence: 1,
    author_id: "human",
    actor_kind: "human" as const,
    purpose: "conversation" as const,
    content:
      "Leggi (https://example.org/article?utm_source=chat) e https://example.org/altro#heading.",
  };
  expect(
    sharedConversationLinks([
      message,
      {
        ...message,
        id: "m2",
        sequence: 2,
        content: "https://example.org/article https://second.example/",
      },
      {
        ...message,
        id: "ai",
        actor_kind: "miriam",
        content: "https://model.example",
      },
      {
        ...message,
        id: "system",
        author_id: null,
        content: "https://system.example",
      },
      {
        ...message,
        id: "sensitive",
        content: [
          "https://private.example/?invite=synthetic",
          "http://localhost/private",
          "http://192.168.0.1",
          "https://employee:synthetic@admin.example",
          "https://mail.example/person%40example.test",
          "https://phone.example/+390612345678",
          "https://docs.example/?X-Amz-Signature=synthetic",
          "https://accounts.example/change-password/synthetic",
          "https://discord.gg/private",
          "https://auth.example/#access_token=synthetic",
        ].join(" "),
      },
    ]),
  ).toEqual([
    {
      host: "example.org",
      messages: [
        { id: "m2", sequence: 2 },
        { id: "m1", sequence: 1 },
      ],
    },
    { host: "second.example", messages: [{ id: "m2", sequence: 2 }] },
  ]);
});

it("shares an exact page with its human source and keeps the latest repeat after reload", () => {
  const address = "https://example.org/Guida_(web)?tema=spazio#parte-2";
  const content = pageMessage("  " + address + "  ");
  expect(content).toBe("Pagina condivisa: " + address);
  const first = {
    id: "first",
    sequence: 2,
    content: content!,
    author_id: "human",
    actor_kind: "human" as const,
    purpose: "conversation" as const,
  };
  const messages = [
    { ...first, id: "repeat", sequence: 9 },
    first,
    { ...first, id: "ai", actor_kind: "miriam" as const, sequence: 10 },
    {
      ...first,
      id: "welcome",
      purpose: "workspace_welcome" as const,
      sequence: 11,
    },
    {
      ...first,
      id: "mention",
      content: "Per la riunione: https://example.org/altro",
      sequence: 12,
    },
  ];
  const saved = pageMessage(address, true);
  expect(saved).toBe("Pagina salvata: " + address);
  expect(sharedPages([{ ...first, content: saved! }])).toEqual([
    { href: address, id: "first", sequence: 2 },
  ]);
  expect(sharedPages(messages)).toEqual([
    { href: address, id: "repeat", sequence: 9 },
  ]);
  expect(sharedConversationLinks(messages)).toEqual([
    { host: "example.org", messages: [{ id: "mention", sequence: 12 }] },
  ]);
});

it("rejects invalid, access-related and oversized URLs before creating a shared page", () => {
  for (const url of [
    "javascript:void(0)",
    "file:///tmp/file",
    "https://user:pass@example.org/",
    "https://example.org/?token=private",
    "http://10.0.0.1/",
    "https://example.org/one https://example.org/two",
    "https://example.org/" + "a".repeat(12000),
  ])
    expect(pageMessage(url)).toBeUndefined();
});

it("labels saved pages without fetching metadata or exposing query strings and retains their exact searchable destination", () => {
  const long =
    "https://example.org/design/raccolta%20foto?filter=autunno#" +
    "x".repeat(300);
  expect(shortPageLabel(long)).toBe("example.org/…/raccolta foto");
  expect(shortPageLabel("https://example.org/?q=segreto")).toBe("example.org");
  expect(shortPageLabel("https://example.org/" + "a".repeat(350))).toBe(
    "example.org/" + "a".repeat(35) + "…",
  );
  const message = {
    id: "link",
    actor_kind: "human",
    author_id: "ada",
    purpose: "conversation",
    sequence: 1,
    content: pageMessage(long, true)!,
    created_at: "2026-11-19T12:00:00Z",
  } as Snapshot["messages"][number];
  for (const personal of [true, false]) {
    const view = libraryView(
      {
        messages: [{ ...message, content: pageMessage(long, personal)! }],
        sources: [],
      },
      {
        tab: "Collegamenti",
        term: "autunno",
        type: "",
        period: "all",
        day: "",
        until: "",
        personal,
      },
    );
    expect(view.links).toEqual([
      { id: "link", title: "example.org/…/raccolta foto", url: long },
    ]);
  }
});
