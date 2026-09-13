import { createServer } from "node:http";
import { Readable } from "node:stream";
import { once } from "node:events";
import { handleAPI } from "./server/api.ts";
import { pool } from "./server/db.ts";

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 3002);
const server = createServer(async (incoming, outgoing) => {
  const abort = new AbortController();
  outgoing.on("close", () => abort.abort());
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers))
      if (value !== undefined)
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    // Direct listener trusts only the socket, never client-supplied proxy IP headers.
    headers.set(
      "x-forwarded-for",
      incoming.socket.remoteAddress ?? "127.0.0.1",
    );
    headers.set("x-real-ip", incoming.socket.remoteAddress ?? "127.0.0.1");
    const init: RequestInit & { duplex?: "half" } = {
      method: incoming.method,
      headers,
      signal: abort.signal,
    };
    if (incoming.method !== "GET" && incoming.method !== "HEAD") {
      init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      init.duplex = "half";
    }
    const response = await handleAPI(
      new Request(`http://127.0.0.1:${port}${incoming.url}`, init),
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body) {
        if (abort.signal.aborted) break;
        if (!outgoing.write(chunk))
          await once(outgoing, "drain", { signal: abort.signal });
      }
    }
    outgoing.end();
  } catch {
    if (!outgoing.headersSent)
      outgoing.writeHead(500, { "Cache-Control": "no-store" });
    outgoing.end();
  }
});
server.listen(port, host, () =>
  console.log(`MIRIAM API listening on ${host}:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    server.close(() => void pool.end());
    server.closeAllConnections();
  });
