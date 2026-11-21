export const releaseHeader = "x-rimiam-web-release";
export const staleHeader = "x-rimiam-web-update";
export const staleEvent = "rimiam:web-update";
export function releaseId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
