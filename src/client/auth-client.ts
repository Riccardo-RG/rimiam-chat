"use client";
import { createAuthClient } from "better-auth/react";

let nextSessionRead = 0;

export function sessionRetryDelay() {
  return Math.max(0, nextSessionRead - Date.now());
}

// A throttled session lookup is temporary. Keep the retry tied to this read,
// without replaying account creation, invitation acceptance or any other write.
export const auth = createAuthClient({
  fetchOptions: {
    onResponse({ request, response }) {
      if (!new URL(request.url).pathname.endsWith("/get-session")) return;
      if (response.status !== 429) {
        nextSessionRead = 0;
        return;
      }
      const header =
        response.headers.get("retry-after") ??
        response.headers.get("x-retry-after");
      const seconds = Number(header);
      const delay =
        header && Number.isFinite(seconds)
          ? Math.max(1, seconds) * 1000
          : Math.max(1000, Date.parse(header ?? "") - Date.now()) || 60000;
      nextSessionRead = Date.now() + delay;
    },
  },
});
