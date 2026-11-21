export const destinations = {
  "": ["Chat", "chat"],
  people: ["Persone e accesso", "people"],
  goal: ["Direzione", "goal"],
  context: ["Contesto", "context"],
  work: ["In programma", "work"],
  artifacts: ["Condivisi", "files"],
  attention: ["Attività e argomenti", "branch"],
  sources: ["Fonti e ricerca", "files"],
  calendar: ["Calendario", "calendar"],
  email: ["Email", "mail"],
  feedback: ["Feedback beta", "chat"],
  notifications: ["Notifiche", "bell"],
  guide: ["Guida e comandi", "guide"],
} as const;
export type Destination = keyof typeof destinations;

export const tools: readonly Destination[] = [
  "work",
  "context",
  "people",
  "goal",
  "attention",
  "sources",
  "calendar",
  "email",
  "feedback",
  "notifications",
  "guide",
];
export const index: readonly {
  title: string;
  views: readonly Destination[];
}[] = [
  { title: "Spazio condiviso", views: ["goal", "people", "context"] },
  {
    title: "Lavoro e materiali",
    views: ["attention", "work", "artifacts", "sources"],
  },
  {
    title: "Strumenti",
    views: ["calendar", "email", "notifications", "feedback", "guide"],
  },
];
