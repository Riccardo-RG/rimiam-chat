// Present known server-authored labels; objectives, quotes and evidence retain their original text.
export function workEventSummary(kind: string, recorded: string) {
  const prefix = "Miriam prepara un'analisi: ";
  if (kind === "started" && recorded.startsWith(prefix))
    return "Emme prepara un'analisi: " + recorded.slice(prefix.length);
  if (
    kind === "working" &&
    recorded === "Miriam sta analizzando il materiale condiviso pertinente."
  )
    return "Emme sta analizzando il materiale condiviso pertinente.";
  return recorded;
}

export function workstreamDescription(origin: string, description: string) {
  if (
    origin === "miriam" &&
    [
      "Organizzazione semantica proposta da Miriam; non ancora un filone attivo.",
      "Organizzazione semantica proposta da Emme; non ancora un filone attivo.",
    ].includes(description)
  )
    return "Organizzazione semantica proposta da Emme; non ancora un argomento attivo.";
  return description;
}
