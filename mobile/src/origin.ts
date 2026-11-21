export function apiOrigin(input: string, allowEmulator: boolean) {
  const url = new URL(input.trim());
  const local = ["localhost", "127.0.0.1", "[::1]", "10.0.2.2"].includes(
    url.hostname,
  );
  if (
    (url.protocol !== "https:" &&
      !(allowEmulator && local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Indica l’indirizzo HTTPS di RIMIAM, senza percorso.");
  return url.origin;
}

export function apiUrl(origin: string, path: string) {
  const url = new URL(path, origin);
  if (
    !path.startsWith("/api/v1/") ||
    url.origin !== origin ||
    !url.pathname.startsWith("/api/v1/") ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error("Percorso API non valido.");
  }
  return url.href;
}
