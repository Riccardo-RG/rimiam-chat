// Installed before hydration. Include the shell version only on this installation's API calls.
// Native bearer clients, OAuth navigations and external provider requests keep their own protocol.
import {
  releaseHeader,
  releaseId,
  staleEvent,
  staleHeader,
} from "./shared/web-release";
const compiled = process.env.RIMIAM_WEB_RELEASE;
if (releaseId(compiled)) {
  const send = window.fetch.bind(window);
  let writes = 0;
  window.fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      location.href,
    );
    if (
      url.origin !== location.origin ||
      !url.pathname.startsWith("/api/") ||
      url.pathname === "/api/release"
    )
      return send(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const write = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
    if (
      write &&
      (!navigator.onLine ||
        document.documentElement.dataset.releaseGate === "locked")
    )
      throw new TypeError("RIMIAM non è disponibile per le modifiche.");
    headers.set(releaseHeader, compiled);
    if (write)
      document.documentElement.dataset.releaseWrites = String(++writes);
    try {
      const response = await send(input, { ...init, headers });
      const required = response.headers.get(staleHeader);
      if (
        response.status === 409 &&
        releaseId(required) &&
        required !== compiled
      ) {
        document.documentElement.dataset.releaseGate = "locked";
        window.dispatchEvent(new CustomEvent(staleEvent, { detail: required }));
      }
      return response;
    } finally {
      if (write)
        document.documentElement.dataset.releaseWrites = String(--writes);
    }
  };
}
