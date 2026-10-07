export function initials(name: string) {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return parts.length
    ? [parts[0], ...(parts.length > 1 ? [parts.at(-1)!] : [])]
        .map((part) => Array.from(part)[0])
        .join("")
        .toLocaleUpperCase("it-IT")
    : "?";
}
export function messageDay(value: string) {
  return new Date(value).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
export function messageTime(value: string) {
  return new Date(value).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
