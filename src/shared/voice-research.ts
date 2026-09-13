// A spoken request prepares a visible query. It never discloses Workspace context
// or invokes the research provider before the existing explicit query command.
export function voiceResearchQuery(transcript: string | null): string | null {
  if (!transcript) return null;
  const match = transcript
    .trim()
    .match(
      /^(?:(?:ehi\s+)?(?:miriam|rimiam)[,:]?\s+)?(?:per favore\s+)?(?:cerca (?:sul web|online|su internet)|fai una ricerca (?:sul web|online|su internet))(?:\s+(?:su|per|riguardo))?\s+(.+)$/i,
    );
  const query = match?.[1].trim();
  return query && query.length <= 500 ? query : null;
}
