/** Commands and explicit assistant addresses in a direct chat remain ordinary messages. */
export function showDirectAssistantHint(text: string) {
  return /^\s*(?:\/|@(?:emme|miriam)\b|(?:chiedi\s+a|ask)\s+@?(?:emme|miriam)\b|emme\b)/i.test(
    text,
  );
}
