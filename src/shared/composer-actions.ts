import { translateUi, type UiLocale } from "./i18n";

export type ComposerActionPermissions = {
  canInvite: boolean;
  canContribute: boolean;
  fieldHelpActive?: boolean;
};
type Entry = {
  id: string;
  shortcuts: readonly [string, ...string[]];
  label: string;
  description: string;
  icon: string;
  keywords?: string;
  needs?: keyof ComposerActionPermissions;
};
const actions = [
  {
    id: "documents",
    shortcuts: ["/documenti", "/file"],
    label: "Apri il raccoglitore",
    description:
      "Ritrova foto, file e link condivisi nello spazio oppure scrivi una nota.",
    icon: "files",
    keywords: "libreria raccolta artefatti allegati fonti pdf file condiviso",
  },
  {
    id: "sketch",
    shortcuts: ["/h", "/disegna", "/draw"],
    label: "Fai un disegno",
    description: "Disegna a mano libera e aggiungi il disegno al messaggio.",
    icon: "files",
    keywords: "schizzo penna sketch draw drawing",
    needs: "canContribute",
  },
  {
    id: "upload",
    shortcuts: ["/carica"],
    label: "Carica un file",
    description: "Aggiungi un file alle fonti dello spazio.",
    icon: "plus",
    keywords: "upload allega documento pdf",
    needs: "canContribute",
  },
  {
    id: "research",
    shortcuts: ["/ricerca"],
    label: "Prepara una ricerca sul web",
    description:
      "Scrivi cosa cercare, poi autorizza la condivisione della domanda.",
    icon: "files",
    keywords: "internet fonti cerca online",
    needs: "canContribute",
  },
  {
    id: "analyze",
    shortcuts: ["/analizza"],
    label: "Prepara un’analisi con Emme",
    description:
      "Descrivi cosa vuoi capire dai materiali condivisi. L’analisi inizia quando invii la richiesta.",
    icon: "spark",
    keywords: "brief analisi lavoro emme",
    needs: "canContribute",
  },
  {
    id: "work",
    shortcuts: ["/dafare", "/lavoro"],
    label: "Da fare e promemoria",
    description: "Consulta attività, scadenze e promemoria dello spazio.",
    icon: "work",
    keywords: "tasks lista compiti follow-up active work",
  },
  {
    id: "new-task",
    shortcuts: ["/task"],
    label: "Nuova attività",
    description: "Prepara un’attività e scegli se indicare una scadenza.",
    icon: "plus",
    keywords: "attività crea nuovo compito",
    needs: "canContribute",
  },
  {
    id: "context",
    shortcuts: ["/contesto"],
    label: "Consulta il contesto",
    description:
      "Consulta le informazioni che il gruppo ha scelto come riferimento.",
    icon: "context",
  },
  {
    id: "questions",
    shortcuts: ["/domande"],
    label: "Vedi le domande aperte",
    description: "Ritrova i punti ancora da chiarire.",
    icon: "chat",
    keywords: "questioni",
  },
  {
    id: "goal",
    shortcuts: ["/goal"],
    label: "Apri l’obiettivo",
    description: "Consulta l’obiettivo dello spazio e le adesioni.",
    icon: "goal",
  },
  {
    id: "activity",
    shortcuts: ["/attività"],
    label: "Apri attività e argomenti",
    description: "Riprendi un argomento o ispeziona l’attività dello spazio.",
    icon: "branch",
    keywords: "thread workstream",
  },
  {
    id: "ask-emme",
    shortcuts: ["/emme"],
    label: "Chiedi a Emme",
    description: "Prepara una domanda nel compositore.",
    icon: "spark",
    keywords: "ai aiuto assistente",
    needs: "canContribute",
  },
  {
    id: "invite",
    shortcuts: ["/invita"],
    label: "Invita una persona",
    description: "Scegli chi invitare nello spazio.",
    icon: "invite",
    keywords: "contatti partecipanti",
    needs: "canInvite",
  },
  {
    id: "people",
    shortcuts: ["/persone"],
    label: "Vedi le persone",
    description: "Consulta i partecipanti e gli accessi.",
    icon: "people",
    keywords: "membri",
  },
  {
    id: "calendar",
    shortcuts: ["/calendario"],
    label: "Apri il calendario",
    description: "Consulta date ed eventi dello spazio.",
    icon: "calendar",
  },
  {
    id: "email",
    shortcuts: ["/email"],
    label: "Apri la posta",
    description: "Accedi agli strumenti email dello spazio.",
    icon: "mail",
    keywords: "mail gmail",
  },
  {
    id: "notifications",
    shortcuts: ["/notifiche"],
    label: "Gestisci le notifiche",
    description: "Controlla gli avvisi per questo dispositivo.",
    icon: "bell",
  },
  {
    id: "feedback",
    shortcuts: ["/feedback"],
    label: "Apri i feedback beta",
    description: "Consulta i feedback e il report dei test.",
    icon: "chat",
  },
  {
    id: "guide",
    shortcuts: ["/guida"],
    label: "Leggi la guida",
    description: "Scopri come usare gli strumenti dello spazio.",
    icon: "context",
    keywords: "help istruzioni",
  },
] as const satisfies readonly Entry[];
export type ComposerActionId = (typeof actions)[number]["id"];
export type ComposerDestination = Exclude<
  ComposerActionId,
  "ask-emme" | "analyze"
>;
export type ComposerAction = Omit<Entry, "id" | "icon"> & {
  id: ComposerActionId;
  icon: (typeof actions)[number]["icon"];
};

// Keep commands in either language usable when the interface language changes.
const englishShortcuts: Partial<Record<ComposerActionId, Entry["shortcuts"]>> =
  {
    documents: ["/files", "/documents"],
    sketch: ["/h", "/draw"],
    upload: ["/upload"],
    research: ["/research"],
    analyze: ["/analyze"],
    work: ["/tasks", "/reminders"],
    context: ["/context"],
    questions: ["/questions"],
    activity: ["/activity", "/topics"],
    invite: ["/invite"],
    people: ["/people"],
    calendar: ["/calendar"],
    notifications: ["/notifications"],
    guide: ["/guide", "/help"],
  };

export function analysisDraft(draft: string, locale: UiLocale = "it") {
  if (/^@Emme\b[\s,:]*(?:analizza|analyze)\s*:/iu.test(draft)) return draft;
  const objective = draft.replace(/^@Emme(?:\s*[:,]\s*|\s+|$)/iu, "");
  return `@Emme ${locale === "en" ? "analyze" : "analizza"}: ${objective}`;
}

function normalized(text: string) {
  return text
    .trim()
    .replace(/^\//, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}
function aliases(item: ComposerAction) {
  return [...item.shortcuts, ...(englishShortcuts[item.id] ?? [])];
}
function matchesShortcut(action: ComposerAction, query: string) {
  return aliases(action).some((shortcut) => normalized(shortcut) === query);
}
export function availableComposerActions(
  permissions: ComposerActionPermissions,
  query = "",
  locale: UiLocale = "it",
): ComposerAction[] {
  const search = normalized(query);
  const terms = search.split(/\s+/).filter(Boolean);
  const permitted: ComposerAction[] = actions.filter(
    (item) =>
      (!("needs" in item) || permissions[item.needs]) &&
      !(item.id === "analyze" && permissions.fieldHelpActive),
  );
  const filtered = !terms.length
    ? permitted
    : permitted
        .filter((item) => {
          const searchable = normalized(
            `${aliases(item).join(" ")} ${item.label} ${item.description} ${translateUi("en", item.label)} ${translateUi("en", item.description)} ${item.keywords ?? ""}`,
          );
          return terms.every((term) => searchable.includes(term));
        })
        .sort(
          (a, b) =>
            Number(matchesShortcut(b, search)) -
            Number(matchesShortcut(a, search)),
        );
  if (locale === "it") return filtered;
  return filtered.map((item) => ({
    ...item,
    label: translateUi(locale, item.label),
    description: translateUi(locale, item.description),
    shortcuts: englishShortcuts[item.id] ?? item.shortcuts,
  }));
}

// Normal sentences, URLs, paths and the existing "/feedback …" message format
// remain ordinary composer input. Only the initial slash or a complete pasted
// command opens the picker; navigation still needs an explicit selection.
export function launcherQuery(previous: string, next: string): string | null {
  if (previous || !next.startsWith("/")) return null;
  if (next === "/") return "";
  if (/\s/.test(next)) return null;
  const query = normalized(next);
  return actions.some((action) => matchesShortcut(action, query))
    ? next.slice(1)
    : null;
}
