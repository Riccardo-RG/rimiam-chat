export function resolveMentionIds(
  content: string,
  people: { id: string; name: string }[],
  selected: string[] = [],
) {
  const normalize = (text: string) =>
    text.normalize("NFC").toLocaleLowerCase("it-IT");
  const aliases = new Map<string, Set<string>>();
  for (const person of people) {
    const name = normalize(person.name).trim();
    for (const alias of [name, name.split(/\s+/u)[0]]) {
      if (!alias || alias === "emme") continue;
      const ids = aliases.get(alias) ?? new Set<string>();
      ids.add(person.id);
      aliases.set(alias, ids);
    }
  }
  const text = normalize(content),
    names = [...aliases.keys()].sort((a, b) => b.length - a.length);
  const result = new Set<string>();
  for (const match of text.matchAll(/(^|[^\p{L}\p{N}_.@-])@/gu)) {
    const suffix = text.slice(match.index + match[0].length);
    const name = names.find(
      (alias) =>
        suffix.startsWith(alias) &&
        !/^([\p{L}\p{N}_-])/u.test(suffix.slice(alias.length)),
    );
    if (!name) continue;
    const matches = aliases.get(name)!;
    for (const id of matches)
      if (matches.size === 1 || selected.includes(id)) result.add(id);
  }
  return [...result];
}

export function mentionAtCaret(text: string, caret: number) {
  const match = text
    .slice(0, caret)
    .match(/(?:^|[^\p{L}\p{N}_.@-])@([^@\n]{0,100})$/u);
  return match
    ? { query: match[1], start: caret - match[1].length - 1, end: caret }
    : null;
}
export function insertMention(text: string, caret: number, name: string) {
  const token = mentionAtCaret(text, caret);
  if (!token) return null;
  const prefix = text.slice(0, token.start) + "@" + name + " ";
  const content = prefix + text.slice(caret).replace(/^[\p{L}\p{N}_-]+/u, "");
  return content.length <= 12000
    ? { text: content, caret: prefix.length }
    : null;
}
