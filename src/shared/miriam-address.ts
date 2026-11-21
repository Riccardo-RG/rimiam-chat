const historicalNames = ["emme", "miriam", "rimiam"];
const normalized = (name: string) => name.trim().toLowerCase();

function assistantPrefix(content: string, displayName = "Emme") {
  const names = [...new Set([normalized(displayName), ...historicalNames])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const expression = new RegExp(
    `^\\s*(?:(?:ciao|ehi|hey|hello|hi)[\\s,]+)?@?(${names.join("|")})(?![\\p{L}\\p{M}\\p{N}_])`,
    "iu",
  );
  return expression.exec(content);
}

// This retained request plus its validated source reference is the one-tap reply.
export const askAboutMessage = "@Emme, rispondi a questo messaggio.";
export const defaultQuotedQuestion = "Rispondi a questo messaggio.";

export function isSourceQuestion(
  content: string,
  kind: string | undefined,
  quoted: boolean,
  displayName = "Emme",
) {
  return (
    kind === "source" &&
    (content === askAboutMessage ||
      (quoted && isAssistantAddress(content, displayName)))
  );
}

/** A human namesake takes precedence over both an old alias and a customized one.
 * @Emme remains the unambiguous product address, including after a rename.
 */
export function potentiallyHumanAddress(content: string, displayName = "Emme") {
  const alias = assistantPrefix(content, displayName)?.[1];
  return alias && normalized(alias) !== "emme" ? normalized(alias) : undefined;
}
export function legacyAssistantAddress(content: string) {
  const alias = potentiallyHumanAddress(content);
  return alias === "miriam" || alias === "rimiam" ? alias : undefined;
}
export function withoutAssistantAddress(content: string, displayName = "Emme") {
  const match = assistantPrefix(content, displayName);
  return match
    ? content.slice(match[0].length).replace(/^\s*[,:]?\s*/u, "")
    : content;
}
export function isAssistantAddress(content: string, displayName = "Emme") {
  return assistantPrefix(content, displayName) !== null;
}
export function directlyAddressesMiriam(content: string) {
  return isAssistantAddress(content);
}
export function addressMiriam(content: string) {
  return directlyAddressesMiriam(content) && !legacyAssistantAddress(content)
    ? content
    : `@Emme ${content}`;
}
