// A deliberately bounded direct command, not an AI permission or a semantic classifier.
// Unclear, compound or quoted instructions remain ordinary Conversation input.
export function requestedWorkstreamTitle(content: string): string | null {
  if (/[\r\n;]/u.test(content)) return null;
  const match =
    /^(?:@?(?:miriam|rimiam)[,:]?\s+)?(?:per favore\s+|please\s+)?(?:(?:puoi|potresti)\s+(?:creare|aprire)|crea|apri|create|open)\s+(?:un(?: nuovo)?|a(?: new)?)\s+(?:filone|subthread|sub-thread|workstream|thread)\s+(?:(?:chiamato|intitolato|denominato|named|called)\s+|su\s+)?(.+?)\s*[.!?]?$/iu.exec(
      content.trim(),
    );
  if (!match) return null;
  let title = match[1].trim();
  const quoted = /^(?:"([^"\n]+)"|“([^”\n]+)”|«([^»\n]+)»)$/u.exec(title);
  if (quoted) title = quoted.slice(1).find(Boolean)!;
  else if (/["“”«»<>:]/u.test(title) || title.split(/\s+/u).length > 6)
    return null;
  if (
    !title ||
    title.length > 160 ||
    /\b(?:privat[oaie]|private|secret|segreto|soltanto|solo per|only for|invit\w*|invia\w*|send|poi|then|anche|also|non|not|senza|without|se|if|che|that|condivid\w*|share|cancell\w*|delete|rinomin\w*|rename|domani|dopo|quando|prima|appena|purché|oppure|altrimenti|aspetta|attendi|tomorrow|later|when|once|after|before|unless|until|wait|instead|otherwise|aggiorn\w*|approv\w*)\b/iu.test(
      title,
    ) ||
    /\s(?:e|and)\s+(?:crea|apri|aggiungi|modifica|sposta|create|open|add|change|move)\b/iu.test(
      title,
    ) ||
    /[!?]/u.test(title)
  )
    return null;
  return title.trim();
}

export function workstreamNameKey(title: string) {
  return title
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("it");
}
