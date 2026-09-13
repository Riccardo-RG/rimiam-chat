import { z } from "zod";
import { DomainError } from "./errors.ts";

const publicUrl = z.url().refine((value) => {
  const u = new URL(value);
  return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password;
});
export const researchResultSchema = z.object({
  title: z.string().trim().min(1).max(240),
  url: publicUrl,
  excerpt: z.string().trim().min(1).max(12000),
});
export const researchResultsSchema = z.array(researchResultSchema).max(20);
export interface ResearchProvider {
  readonly name: string;
  search(query: string): Promise<z.infer<typeof researchResultsSchema>>;
}

export function braveResearchProvider(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): ResearchProvider {
  return {
    name: "brave-search",
    async search(query) {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", z.string().min(1).max(500).parse(query));
      url.searchParams.set("count", "5");
      url.searchParams.set("text_decorations", "false");
      const response = await fetcher(url, {
        headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
      if (!response.ok)
        throw new DomainError(
          response.status === 429
            ? "RESEARCH_RATE_LIMITED"
            : "RESEARCH_PROVIDER_FAILED",
          502,
        );
      // Bound untrusted provider payloads before parsing. Never fetch returned URLs.
      const reader = response.body?.getReader();
      if (!reader) throw new DomainError("RESEARCH_INVALID_RESULT", 502);
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 1048576) {
            await reader.cancel();
            throw new DomainError("RESEARCH_INVALID_RESULT", 502);
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const parsed = z
        .object({
          web: z
            .object({
              results: z
                .array(
                  z.object({
                    title: z.string(),
                    url: z.string(),
                    description: z.string(),
                  }),
                )
                .max(20),
            })
            .optional(),
        })
        .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      return researchResultsSchema.parse(
        (parsed.web?.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          excerpt: r.description,
        })),
      );
    },
  };
}
export function configuredResearchProvider(): ResearchProvider {
  if (
    process.env.RESEARCH_PROVIDER !== "brave" ||
    !process.env.BRAVE_SEARCH_API_KEY?.trim()
  )
    throw new DomainError("RESEARCH_CONFIGURATION_REQUIRED", 503);
  return braveResearchProvider(process.env.BRAVE_SEARCH_API_KEY);
}
