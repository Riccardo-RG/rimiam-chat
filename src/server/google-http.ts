import { createHash } from "node:crypto";
import { DomainError, requireThat } from "./errors.ts";

export const googleHash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export interface GoogleAuthorization {
  accessToken: string;
  email: string;
  scopes: string[];
}
export type GoogleToken = (
  credentialId: string,
  signal: AbortSignal,
) => Promise<GoogleAuthorization>;
export class GoogleHTTPError extends DomainError {
  constructor(readonly httpStatus: number) {
    super(
      httpStatus === 429
        ? "GOOGLE_RATE_LIMITED"
        : httpStatus === 401
          ? "GOOGLE_RECONNECT_REQUIRED"
          : "GOOGLE_REQUEST_FAILED",
      502,
    );
  }
}
// Fixed API hosts, bounded bodies, no redirect, retries or provider response text in errors/logs.
export async function googleJSON(
  url: string | URL,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
  maxBytes = 16 * 1024 * 1024,
): Promise<unknown> {
  const target = new URL(url);
  requireThat(
    target.protocol === "https:" &&
      !target.username &&
      !target.password &&
      [
        "www.googleapis.com",
        "gmail.googleapis.com",
        "oauth2.googleapis.com",
        "openidconnect.googleapis.com",
      ].includes(target.hostname),
    "GOOGLE_ENDPOINT_REJECTED",
    400,
  );
  const response = await fetcher(target, { ...init, redirect: "error" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new GoogleHTTPError(response.status);
  }
  const reader = response.body?.getReader();
  requireThat(reader, "GOOGLE_INVALID_RESPONSE", 502);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new DomainError("GOOGLE_RESPONSE_TOO_LARGE", 502);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DomainError("GOOGLE_INVALID_RESPONSE", 502);
  }
}
