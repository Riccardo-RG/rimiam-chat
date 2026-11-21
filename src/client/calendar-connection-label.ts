export function calendarConnectionLabel(linked: boolean | null | undefined) {
  if (linked == null) return "Gestisci calendari";
  return linked ? "Calendari collegati" : "Collega calendario";
}
