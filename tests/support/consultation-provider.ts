import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** Local Ollama-compatible boundary for browser journeys. This server is
 * created only by the test harness; external credentials are never needed. */
export async function consultationProvider() {
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url !== "/api/chat") {
        res.writeHead(404).end();
        return;
      }
      let raw = "";
      for await (const chunk of req) raw += String(chunk);
      const { messages } = JSON.parse(raw) as {
        messages: { role: string; content: string }[];
      };
      const instruction = messages.find((m) => m.role === "system")!.content;
      const material = JSON.parse(
        messages.find((m) => m.role === "user")!.content,
      );
      let output;
      if (instruction.startsWith("Draft a useful editable document")) {
        output = {
          answer: "# Piano di lancio\n\nInvitiamo due tester alla sessione.",
          keys: material.evidence
            .slice(0, 1)
            .map((e: { key: string }) => e.key),
          moreTerms: [],
        };
      } else if (
        instruction.startsWith("Answer this member's private question")
      ) {
        output = {
          answer: "La sessione di lancio è in preparazione.",
          keys: material.evidence
            .slice(0, 1)
            .map((e: { key: string }) => e.key),
          moreTerms: [],
        };
      } else if (instruction.startsWith("You write a private recap")) {
        output = {
          text: "Il gruppo sta preparando la sessione di lancio.",
          sourceIds: material[0].sourceIds.slice(0, 1),
        };
      } else {
        res.writeHead(422).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          message: { content: JSON.stringify(output) },
          done: true,
        }),
      );
    } catch {
      res.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  return {
    url: "http://127.0.0.1:" + (server.address() as AddressInfo).port,
    close: () => server.close(),
  };
}
